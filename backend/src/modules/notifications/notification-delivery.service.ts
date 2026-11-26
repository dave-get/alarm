import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { ExpoPushMessage } from 'expo-server-sdk';
import type { AppConfig } from '../../config/configuration.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { NOTIFICATIONS_QUEUE, NotificationJobs, RedisChannels } from '../redis/redis.constants.js';
import { RedisPubSubService } from '../redis/redis-pubsub.service.js';
import { ANDROID_CHANNEL_ID, NotificationsService } from './notifications.service.js';

/** Expo error codes worth retrying; everything else is permanent. */
const TRANSIENT = new Set(['MessageRateExceeded', 'ExpoError', 'ProviderError']);

export interface AlertTriggeredJob {
  outboxEventId: string;
  alertEventId: string;
}

/**
 * Plan §9: create the user-facing notification, send to every active device,
 * store tickets, retry transient errors with backoff (BullMQ), check receipts,
 * disable invalid tokens. Per (notification, device) delivery rows are unique, and
 * only PENDING rows are (re)sent, so retries don't resend what Expo already accepted.
 * External push is still not exactly-once: a crash between Expo accepting a chunk and
 * the database recording it can resend that chunk.
 */
@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: NotificationsService,
    private readonly pubsub: RedisPubSubService,
    private readonly config: ConfigService<AppConfig, true>,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
  ) {}

  async handleAlertTriggered(job: AlertTriggeredJob) {
    const event = await this.prisma.alertEvent.findUnique({ where: { id: job.alertEventId }, include: { alert: true } });
    if (!event) {
      this.logger.warn(`Alert event ${job.alertEventId} not found; skipping`);
      return { skipped: 'EVENT_NOT_FOUND' };
    }
    const price = event.triggeredPrice.toString();
    const target = event.targetPrice.toString();
    let notification = await this.prisma.notification.findUnique({ where: { alertEventId: event.id } });
    let created = false;
    if (!notification) {
      try {
        notification = await this.prisma.notification.create({
          data: {
            userId: event.userId,
            alertEventId: event.id,
            type: 'PRICE_ALERT',
            title: `${event.symbol} Price Alert`,
            body: `${event.symbol} reached ${price} USDT. Target: ${target}`,
            data: {
              type: 'PRICE_ALERT',
              alertId: event.alertId,
              alertEventId: event.id,
              symbol: event.symbol,
              price,
              target,
              condition: event.condition,
            },
          },
        });
        created = true;
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        notification = await this.prisma.notification.findUniqueOrThrow({ where: { alertEventId: event.id } });
      }
    }

    if (created) {
      // In-app real-time event for the owner's open sockets (plan §11 alert:triggered).
      await this.pubsub
        .publish(RedisChannels.alertTriggered, {
          userId: event.userId,
          payload: {
            notificationId: notification.id,
            alertEventId: event.id,
            alertId: event.alertId,
            symbol: event.symbol,
            condition: event.condition,
            mode: event.alert.mode,
            status: event.alert.status,
            targetPrice: target,
            triggeredPrice: price,
            triggeredAt: event.triggeredAt,
          },
        })
        .catch(() => undefined);
    }
    return this.deliver(notification.id);
  }

  async deliver(notificationId: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!notification) return { skipped: 'NOTIFICATION_NOT_FOUND' };

    const devices = await this.prisma.device.findMany({ where: { userId: notification.userId, isActive: true } });
    if (!devices.length) return { sent: 0, skipped: 'NO_ACTIVE_DEVICES' };
    await this.prisma.notificationDelivery.createMany({
      data: devices.map((d) => ({ notificationId, deviceId: d.id })),
      skipDuplicates: true,
    });

    const pending = await this.prisma.notificationDelivery.findMany({
      where: { notificationId, status: 'PENDING', device: { isActive: true } },
      include: { device: true },
    });

    const valid = [];
    for (const d of pending) {
      if (this.push.isValidToken(d.device.pushToken)) valid.push(d);
      else {
        await this.fail(d.id, 'INVALID_TOKEN');
        await this.disableDevice(d.deviceId, 'INVALID_TOKEN');
      }
    }
    if (!valid.length) return { sent: 0 };

    const message = (token: string): ExpoPushMessage => ({
      to: token,
      sound: 'default',
      priority: 'high',
      title: notification.title,
      body: notification.body,
      channelId: ANDROID_CHANNEL_ID,
      data: (notification.data ?? {}) as Record<string, unknown>,
    });

    let sent = 0;
    let transient = 0;
    // Chunks of 100 (Expo's limit), recorded per chunk so a later failure doesn't resend earlier chunks.
    for (let i = 0; i < valid.length; i += 100) {
      const chunk = valid.slice(i, i + 100);
      await this.prisma.notificationDelivery.updateMany({
        where: { id: { in: chunk.map((d) => d.id) } },
        data: { attempts: { increment: 1 } },
      });
      let tickets;
      try {
        tickets = await this.push.send(chunk.map((d) => message(d.device.pushToken)));
      } catch (e) {
        await this.prisma.notificationDelivery.updateMany({
          where: { id: { in: chunk.map((d) => d.id) } },
          data: { error: (e as Error).message.slice(0, 500) },
        });
        throw e; // network / 5xx / 429: BullMQ retries with exponential backoff
      }
      for (let j = 0; j < chunk.length; j++) {
        const d = chunk[j];
        const t = tickets[j];
        if (t?.status === 'ok') {
          sent++;
          await this.prisma.notificationDelivery.update({
            where: { id: d.id },
            data: { status: 'SENT', ticketId: t.id, sentAt: new Date(), error: null },
          });
          continue;
        }
        const code = t?.details?.error ?? 'UNKNOWN';
        const msg = t && t.status === 'error' ? `${code}: ${t.message}` : 'Missing ticket';
        if (code === 'DeviceNotRegistered') {
          await this.fail(d.id, msg);
          await this.disableDevice(d.deviceId, code);
        } else if (TRANSIENT.has(code)) {
          transient++;
          await this.prisma.notificationDelivery.update({ where: { id: d.id }, data: { error: msg.slice(0, 500) } });
        } else {
          await this.fail(d.id, msg);
        }
      }
    }
    if (transient) throw new Error(`${transient} push deliveries failed transiently; retrying`);
    return { sent };
  }

  async notificationIdForJob(data: { notificationId?: string; alertEventId?: string }): Promise<string | undefined> {
    if (data.notificationId) return data.notificationId;
    if (!data.alertEventId) return undefined;
    const n = await this.prisma.notification.findUnique({ where: { alertEventId: data.alertEventId }, select: { id: true } });
    return n?.id;
  }

  /** Called when a job has exhausted its attempts. */
  async failPending(notificationId: string, reason: string) {
    await this.prisma.notificationDelivery.updateMany({
      where: { notificationId, status: 'PENDING' },
      data: { status: 'FAILED', error: reason.slice(0, 500) },
    });
  }

  /** Plan §9: check receipts (Expo recommends ~15 minutes after sending). */
  async checkReceipts() {
    const now = Date.now();
    const cutoff = new Date(now - this.config.get('RECEIPT_CHECK_DELAY_MS', { infer: true }));
    const rows = await this.prisma.notificationDelivery.findMany({
      where: { status: 'SENT', ticketId: { not: null }, sentAt: { lte: cutoff }, receiptCheckedAt: null },
      orderBy: { sentAt: 'asc' },
      take: 1000,
    });
    if (!rows.length) return { checked: 0 };

    const receipts = await this.push.receipts(rows.map((r) => r.ticketId!));
    const maxAttempts = this.config.get('NOTIFY_MAX_ATTEMPTS', { infer: true });
    let delivered = 0;
    let failed = 0;
    for (const row of rows) {
      const r = receipts[row.ticketId!];
      if (!r) {
        // Receipts are kept by Expo for ~24h; after that, stop asking.
        if (row.sentAt && now - row.sentAt.getTime() > 24 * 3600 * 1000) {
          await this.prisma.notificationDelivery.update({ where: { id: row.id }, data: { receiptStatus: 'UNAVAILABLE', receiptCheckedAt: new Date() } });
        }
        continue;
      }
      if (r.status === 'ok') {
        delivered++;
        await this.prisma.notificationDelivery.update({
          where: { id: row.id },
          data: { status: 'DELIVERED', receiptStatus: 'ok', receiptCheckedAt: new Date() },
        });
        continue;
      }
      const code = r.details?.error ?? 'UNKNOWN';
      const msg = `${code}: ${r.message}`.slice(0, 500);
      if (code === 'DeviceNotRegistered') await this.disableDevice(row.deviceId, code);
      if (TRANSIENT.has(code) && row.attempts < maxAttempts) {
        await this.prisma.notificationDelivery.update({
          where: { id: row.id },
          data: { status: 'PENDING', receiptStatus: code, error: msg, receiptCheckedAt: new Date(), ticketId: null },
        });
        await this.queue.add(
          NotificationJobs.sendNotification,
          { notificationId: row.notificationId },
          { jobId: `resend-${row.notificationId}-${row.attempts}`, delay: 30_000 },
        );
      } else {
        failed++;
        await this.prisma.notificationDelivery.update({
          where: { id: row.id },
          data: { status: 'FAILED', receiptStatus: code, error: msg, receiptCheckedAt: new Date() },
        });
      }
    }
    this.logger.log('Push receipts checked', { checked: rows.length, delivered, failed });
    return { checked: rows.length, delivered, failed };
  }

  private fail(deliveryId: string, error: string) {
    return this.prisma.notificationDelivery.update({ where: { id: deliveryId }, data: { status: 'FAILED', error: error.slice(0, 500) } });
  }

  private async disableDevice(deviceId: string, reason: string) {
    await this.prisma.device.update({ where: { id: deviceId }, data: { isActive: false, disabledReason: reason } });
    this.logger.warn('Push token disabled', { deviceId, reason });
  }
}
