import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { AppConfig } from '../../config/configuration.js';
import { REDIS_CLIENT } from './redis.constants.js';

type Handler = (payload: unknown) => void;

/** JSON pub/sub between processes. Subscriptions use a dedicated connection. */
@Injectable()
export class RedisPubSubService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisPubSubService.name);
  private subscriber?: Redis;
  private readonly handlers = new Map<string, Set<Handler>>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async publish(channel: string, payload: unknown): Promise<void> {
    await this.redis.publish(channel, JSON.stringify(payload));
  }

  async subscribe(channel: string, handler: Handler): Promise<() => void> {
    if (!this.subscriber) {
      this.subscriber = new Redis(this.config.get('REDIS_URL', { infer: true }), {
        lazyConnect: false,
        maxRetriesPerRequest: null,
      });
      this.subscriber.on('error', (e: Error) => this.logger.warn(`Redis subscriber error: ${e.message}`));
      this.subscriber.on('message', (ch: string, message: string) => {
        let payload: unknown;
        try {
          payload = JSON.parse(message);
        } catch {
          this.logger.warn(`Invalid JSON on channel ${ch}`);
          return;
        }
        for (const h of this.handlers.get(ch) ?? []) {
          try {
            h(payload);
          } catch (e) {
            this.logger.error(`Handler for ${ch} failed: ${(e as Error).message}`);
          }
        }
      });
    }
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      await this.subscriber.subscribe(channel);
    }
    set.add(handler);
    return () => set.delete(handler);
  }

  async onModuleDestroy() {
    if (this.subscriber) await this.subscriber.quit().catch(() => undefined);
  }
}
