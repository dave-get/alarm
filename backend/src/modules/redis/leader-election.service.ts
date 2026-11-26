import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Redis } from 'ioredis';
import type { AppConfig } from '../../config/configuration.js';
import { REDIS_CLIENT } from './redis.constants.js';

const RENEW = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

/**
 * Plan §12 "Multiple instances: single ingestion worker or distributed leadership".
 * A Redis lease (SET NX PX + compare-and-renew). Only the leader ingests market data.
 */
@Injectable()
export class LeaderElectionService implements OnModuleDestroy {
  private readonly logger = new Logger(LeaderElectionService.name);
  readonly instanceId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private timer?: NodeJS.Timeout;
  private leading = false;
  private key = '';
  private listener: (leading: boolean) => void = () => {};

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  get isLeader() {
    return this.leading;
  }

  start(key: string, onChange: (leading: boolean) => void) {
    this.key = key;
    this.listener = onChange;
    const ttl = this.config.get('LEADER_LOCK_TTL_MS', { infer: true });
    const tick = () => void this.tick(ttl);
    tick();
    this.timer = setInterval(tick, Math.max(1000, Math.floor(ttl / 3)));
  }

  private async tick(ttl: number) {
    try {
      let leading: boolean;
      if (this.leading) {
        leading = (await this.redis.eval(RENEW, 1, this.key, this.instanceId, String(ttl))) === 1;
      } else {
        leading = (await this.redis.set(this.key, this.instanceId, 'PX', ttl, 'NX')) === 'OK';
      }
      this.setLeading(leading);
    } catch (error) {
      // Cannot confirm the lease: step down so two instances never ingest at once.
      this.logger.warn(`Leader lease check failed: ${(error as Error).message}`);
      this.setLeading(false);
    }
  }

  private setLeading(leading: boolean) {
    if (leading === this.leading) return;
    this.leading = leading;
    this.logger.log(leading ? `Acquired leadership (${this.instanceId})` : 'Lost leadership');
    this.listener(leading);
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    if (this.leading) {
      await this.redis.eval(RELEASE, 1, this.key, this.instanceId).catch(() => undefined);
      this.leading = false;
    }
  }
}
