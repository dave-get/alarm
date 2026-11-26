import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import type { AppConfig } from '../../config/configuration.js';
import { NOTIFICATIONS_QUEUE, NotificationJobs } from '../redis/redis.constants.js';
import { WorkerHeartbeatService } from '../redis/worker-heartbeat.service.js';
import { NotificationDeliveryService, type AlertTriggeredJob } from './notification-delivery.service.js';

/** BullMQ notification worker (plan §2 "BullMQ notification worker"). */
@Processor(NOTIFICATIONS_QUEUE, { concurrency: 10 })
export class NotificationsProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly delivery: NotificationDeliveryService,
    private readonly config: ConfigService<AppConfig, true>,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
    private readonly heartbeat: WorkerHeartbeatService,
  ) {
    super();
  }

  async onApplicationBootstrap() {
    this.heartbeat.start(['notifications']);
    // One scheduler regardless of how many workers run (upsert is idempotent).
    await this.queue.upsertJobScheduler(
      NotificationJobs.checkReceipts,
      { every: this.config.get('RECEIPT_CHECK_EVERY_MS', { infer: true }) },
      { name: NotificationJobs.checkReceipts, data: {}, opts: { attempts: 1, removeOnComplete: 100, removeOnFail: 100 } },
    );
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case NotificationJobs.alertTriggered:
        return this.delivery.handleAlertTriggered(job.data as AlertTriggeredJob);
      case NotificationJobs.sendNotification:
        return this.delivery.deliver((job.data as { notificationId: string }).notificationId);
      case NotificationJobs.checkReceipts:
        return this.delivery.checkReceipts();
      default:
        this.logger.warn(`Unknown job ${job.name}`);
        return undefined;
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job | undefined, error: Error) {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    this.logger.warn(`Job ${job.name} ${job.id} failed (attempt ${job.attemptsMade}/${attempts}): ${error.message}`);
    if (job.attemptsMade < attempts) return;
    // Retries exhausted: record it on the remaining deliveries.
    const notificationId = await this.delivery.notificationIdForJob(job.data as { notificationId?: string; alertEventId?: string });
    if (notificationId) await this.delivery.failPending(notificationId, `Retries exhausted: ${error.message}`);
  }
}
