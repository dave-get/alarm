import { Controller, Get, Inject, Injectable } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@nestjs/authentication';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthCheck, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import { Redis } from 'ioredis';
import { RawResponse } from '../../common/interceptors/response.interceptor.js';
import { PrismaService } from '../database/prisma.service.js';
import { MarketDataService } from '../market-data/market-data.service.js';
import { REDIS_CLIENT, RedisKeys } from '../redis/redis.constants.js';

@Injectable()
export class DependencyHealthIndicators {
  constructor(
    private readonly indicators: HealthIndicatorService,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  database() {
    return this.indicators.check('database').attempt(async () => {
      await this.prisma.ping();
    }).withTimeout('2s');
  }

  redisPing() {
    return this.indicators.check('redis').attempt(async () => {
      await this.redis.ping();
    }).withTimeout('2s');
  }
}

/** Plan §4 "Health reports connectivity"; §12 "Redis failure: degraded health". */
@ApiTags('health')
@Public()
@SkipThrottle()
@RawResponse()
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly deps: DependencyHealthIndicators,
    private readonly market: MarketDataService,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Liveness (no dependencies)' })
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness: database and Redis' })
  ready() {
    return this.health.check([() => this.deps.database(), () => this.deps.redisPing()]);
  }

  @Get('health/details')
  @ApiOperation({ summary: 'Connectivity of every component: database, Redis, exchange feed, workers, queue' })
  async details() {
    const timed = async <T>(fn: () => Promise<T>) => {
      const started = Date.now();
      try {
        return { status: 'up' as const, latencyMs: Date.now() - started, value: await fn() };
      } catch (e) {
        return { status: 'down' as const, error: (e as Error).message };
      }
    };
    const [database, redis] = await Promise.all([timed(() => this.prisma.ping()), timed(() => this.redis.ping())]);

    let market: unknown = { connection: 'UNKNOWN' };
    const workers: Record<string, number> = {};
    let queue: unknown = null;
    let gaps: number | null = null;
    if (redis.status === 'up') {
      const status = await this.market.getStatus().catch(() => null);
      market = status ?? { connection: 'UNKNOWN' };
      for (const role of ['market', 'outbox', 'notifications']) {
        const keys = await this.redis.keys(RedisKeys.workerHeartbeat(role, '*')).catch(() => []);
        workers[role] = keys.length;
      }
      const raw = await this.redis.hgetall('bull:notifications:meta').catch(() => null);
      queue = raw ? { paused: raw.paused === '1' } : null;
    }
    if (database.status === 'up') {
      gaps = await this.prisma.marketGap.count({ where: { detectedAt: { gt: new Date(Date.now() - 24 * 3600 * 1000) } } }).catch(() => null);
    }

    const marketConn = (market as { connection?: string }).connection;
    const degraded =
      database.status !== 'up' ||
      redis.status !== 'up' ||
      marketConn !== 'CONNECTED' ||
      Object.values(workers).some((n) => n === 0);
    return {
      status: database.status !== 'up' ? 'down' : degraded ? 'degraded' : 'ok',
      database: { status: database.status, ...(database.status === 'up' ? { latencyMs: database.latencyMs } : { error: database.error }) },
      redis: { status: redis.status, ...(redis.status === 'up' ? { latencyMs: redis.latencyMs } : { error: redis.error }) },
      market,
      workers,
      queue,
      unrecoveredGapsLast24h: gaps,
      checkedAt: new Date().toISOString(),
    };
  }
}
