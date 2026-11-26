import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { hostname } from 'node:os';
import { Redis } from 'ioredis';
import { REDIS_CLIENT, RedisKeys } from './redis.constants.js';

export const HEARTBEAT_TTL_SECONDS = 20;

/** Worker processes have no HTTP port: they report liveness through Redis (read by /health/details and the container healthcheck). */
@Injectable()
export class WorkerHeartbeatService implements OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  start(roles: string[], details: () => Record<string, unknown> = () => ({})) {
    const beat = () => {
      const now = Date.now();
      for (const role of roles) {
        void this.redis
          .set(RedisKeys.workerHeartbeat(role, hostname()), JSON.stringify({ at: now, pid: process.pid, ...details() }), 'EX', HEARTBEAT_TTL_SECONDS)
          .catch(() => undefined);
      }
    };
    beat();
    this.timer = setInterval(beat, 5_000);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }
}
