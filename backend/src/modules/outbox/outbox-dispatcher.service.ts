import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { AppConfig } from '../../config/configuration.js';
import { OutboxEventTypes } from '../../common/enums/alert.enums.js';
import { errorMessage } from '../../common/utils/async.js';
import { PrismaService } from '../database/prisma.service.js';
import { NOTIFICATIONS_QUEUE, NotificationJobs, RedisChannels } from '../redis/redis.constants.js';
import { RedisPubSubService } from '../redis/redis-pubsub.service.js';
import { WorkerHeartbeatService } from '../redis/worker-heartbeat.service.js';

interface OutboxRow {
  id: string;
  eventType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

/**
 * Plan §8 step 5: publish committed outbox rows to BullMQ with a unique job ID.
 * Rows are claimed with FOR UPDATE SKIP LOCKED, so several dispatchers can run.
 * If marking a row published fails after enqueueing, the next run enqueues it again
 * with the same job ID and BullMQ deduplicates it.
 */
@Injectable()
export class OutboxDispatcherService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxDispatcherService.name);
  private timer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;
  private running = false;
  private again = false;
  private stopped = false;
  published = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pubsub: RedisPubSubService,
    private readonly heartbeat: WorkerHeartbeatService,
    private readonly config: ConfigService<AppConfig, true>,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap() {
    // Low-latency nudge from the alert engine; polling is the safety net.
    await this.pubsub.subscribe(RedisChannels.outboxNew, () => void this.dispatch());
    this.timer = setInterval(() => void this.dispatch(), this.config.get('OUTBOX_POLL_INTERVAL_MS', { infer: true }));
    this.cleanupTimer = setInterval(() => void this.cleanup(), 60 * 60 * 1000);
    this.heartbeat.start(['outbox'], () => ({ published: this.published }));
    void this.dispatch();
  }

  async dispatch() {
    if (this.stopped) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        const n = await this.dispatchBatch();
        if (n === this.config.get('OUTBOX_BATCH_SIZE', { infer: true })) this.again = true;
      } while (this.again && !this.stopped);
    } catch (e) {
      this.logger.error(`Outbox dispatch failed: ${errorMessage(e)}`);
    } finally {
      this.running = false;
    }
  }

  private async dispatchBatch(): Promise<number> {
    const batch = this.config.get('OUTBOX_BATCH_SIZE', { infer: true });
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<OutboxRow[]>`
          SELECT id, "eventType", "aggregateId", payload
          FROM outbox_events
          WHERE "publishedAt" IS NULL
          ORDER BY "createdAt"
          LIMIT ${batch}
          FOR UPDATE SKIP LOCKED`;
        if (!rows.length) return 0;

        const done: string[] = [];
        for (const row of rows) {
          try {
            await this.enqueue(row);
            done.push(row.id);
          } catch (e) {
            await tx.outboxEvent.update({
              where: { id: row.id },
              data: { attempts: { increment: 1 }, lastError: errorMessage(e).slice(0, 500) },
            });
          }
        }
        if (done.length) {
          await tx.outboxEvent.updateMany({ where: { id: { in: done } }, data: { publishedAt: new Date() } });
          this.published += done.length;
        }
        return rows.length;
      },
      { timeout: 30_000 },
    );
  }

  private async enqueue(row: OutboxRow) {
    switch (row.eventType) {
      case OutboxEventTypes.alertTriggered:
        await this.queue.add(
          NotificationJobs.alertTriggered,
          { outboxEventId: row.id, alertEventId: row.aggregateId },
          { jobId: `outbox-${row.id}` },
        );
        return;
      default:
        throw new Error(`Unknown outbox event type ${row.eventType}`);
    }
  }

  private async cleanup() {
    const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const res = await this.prisma.outboxEvent.deleteMany({ where: { publishedAt: { lt: cutoff } } }).catch(() => ({ count: 0 }));
    if (res.count) this.logger.log(`Removed ${res.count} published outbox rows`);
  }

  onApplicationShutdown() {
    this.stopped = true;
    clearInterval(this.timer);
    clearInterval(this.cleanupTimer);
  }
}
