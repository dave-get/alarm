import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import type { AppConfig } from '../../config/configuration.js';
import { NOTIFICATIONS_QUEUE } from '../redis/redis.constants.js';

/** BullMQ connection and the notifications queue with retry/backoff defaults (plan §8, §9). */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        connection: { url: config.get('REDIS_URL', { infer: true }) },
      }),
    }),
    BullModule.registerQueueAsync({
      name: NOTIFICATIONS_QUEUE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        defaultJobOptions: {
          attempts: config.get('NOTIFY_MAX_ATTEMPTS', { infer: true }),
          backoff: { type: 'exponential', delay: 2_000 },
          // Completed jobs are kept a day so the deterministic jobId deduplicates re-publishes.
          removeOnComplete: { age: 24 * 3600, count: 50_000 },
          removeOnFail: { age: 7 * 24 * 3600 },
        },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
