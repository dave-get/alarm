import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import type { AppConfig } from '../../config/configuration.js';
import { REDIS_CLIENT } from '../../modules/redis/redis.constants.js';
import { RedisThrottlerStorage } from '../../modules/redis/redis-throttler.storage.js';

/**
 * Plan §13 rate limits. Imported after AuthModule so the guard runs after
 * authentication and counts per user (anonymous routes count per IP).
 * Tighter per-route limits use @Throttle on create alarm / register device / test push / sign-in.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, REDIS_CLIENT],
      useFactory: (config: ConfigService<AppConfig, true>, redis: Redis) => ({
        throttlers: [{ ttl: config.get('THROTTLE_TTL_MS', { infer: true }), limit: config.get('THROTTLE_LIMIT', { infer: true }) }],
        storage: new RedisThrottlerStorage(redis),
        getTracker: (req: Record<string, any>) => (req.user ? `user:${req.user.id}` : `ip:${req.ip}`),
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class RateLimitModule {}
