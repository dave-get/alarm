import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { AppConfig } from '../../config/configuration.js';
import { LeaderElectionService } from './leader-election.service.js';
import { REDIS_CLIENT } from './redis.constants.js';
import { RedisPubSubService } from './redis-pubsub.service.js';
import { WorkerHeartbeatService } from './worker-heartbeat.service.js';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const logger = new Logger('Redis');
        const client = new Redis(config.get('REDIS_URL', { infer: true }), { maxRetriesPerRequest: 3, enableOfflineQueue: true });
        client.on('error', (e: Error) => logger.warn(`Redis error: ${e.message}`));
        client.on('ready', () => logger.log('Redis connected'));
        return client;
      },
    },
    RedisPubSubService,
    LeaderElectionService,
    WorkerHeartbeatService,
  ],
  exports: [REDIS_CLIENT, RedisPubSubService, LeaderElectionService, WorkerHeartbeatService],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown() {
    await this.redis.quit().catch(() => undefined);
  }
}
