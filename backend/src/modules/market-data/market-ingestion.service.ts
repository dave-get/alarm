import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { AppConfig } from '../../config/configuration.js';
import { SUPPORTED_SYMBOLS } from '../../common/enums/symbols.enum.js';
import { errorMessage } from '../../common/utils/async.js';
import { AlertEngineService } from '../alerts/alert-engine.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { LeaderElectionService } from '../redis/leader-election.service.js';
import { REDIS_CLIENT, RedisChannels, RedisKeys } from '../redis/redis.constants.js';
import { RedisPubSubService } from '../redis/redis-pubsub.service.js';
import { WorkerHeartbeatService } from '../redis/worker-heartbeat.service.js';
import { MarketStateService } from './market-state.service.js';
import {
  MARKET_PROVIDER,
  MARKET_REST_CLIENT,
  type MarketPrice,
  type MarketProvider,
  type MarketRestClient,
} from './providers/market-provider.interface.js';
import { SymbolPipeline } from './symbol-pipeline.js';

const STATUS_TTL_SECONDS = 30;

/**
 * Market worker (plan §2, §3, §8, §12). Processing order per trade:
 *   1. receive and validate (provider) and reconcile gaps/duplicates (SymbolPipeline)
 *   2. evaluate active alarms (AlertEngine) — atomic trigger + outbox
 *   3. record as latest price; flushed to Redis and published every MARKET_CACHE_FLUSH_MS
 *   4. persist recovery checkpoints every MARKET_CHECKPOINT_INTERVAL_MS
 */
@Injectable()
export class MarketIngestionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MarketIngestionService.name);
  private readonly pipelines = new Map<string, SymbolPipeline>();
  private readonly checkpointDirty = new Map<string, MarketPrice>();
  private timers: NodeJS.Timeout[] = [];
  private ingesting = false;
  private lastStatusJson = '';
  private lastStatusPublishedAt = 0;

  constructor(
    @Inject(MARKET_PROVIDER) private readonly provider: MarketProvider,
    @Inject(MARKET_REST_CLIENT) private readonly rest: MarketRestClient,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly state: MarketStateService,
    private readonly engine: AlertEngineService,
    private readonly prisma: PrismaService,
    private readonly pubsub: RedisPubSubService,
    private readonly leader: LeaderElectionService,
    private readonly heartbeat: WorkerHeartbeatService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  onApplicationBootstrap() {
    this.provider.onPrice((p) => this.pipelines.get(p.symbol)?.push(p));
    this.provider.onConnectionChange((s) => {
      this.state.connection = s;
      void this.publishStatus(true);
    });

    this.timers.push(
      setInterval(() => void this.flushPrices(), this.config.get('MARKET_CACHE_FLUSH_MS', { infer: true })),
      setInterval(() => void this.persistCheckpoints(), this.config.get('MARKET_CHECKPOINT_INTERVAL_MS', { infer: true })),
      setInterval(() => {
        if (this.state.refreshStaleness().length) void this.publishStatus(true);
        else void this.publishStatus(false);
      }, 1_000),
    );

    this.heartbeat.start(['market'], () => ({
      leader: this.leader.isLeader,
      connection: this.state.connection,
      alerts: this.engine.alertCount,
    }));

    this.leader.start(RedisKeys.marketLeader, (leading) => {
      if (leading) void this.startIngestion();
      else void this.stopIngestion();
    });
  }

  private async startIngestion() {
    if (this.ingesting) return;
    this.ingesting = true;
    this.state.leader = this.leader.instanceId;
    this.logger.log('Starting market ingestion');

    await this.engine.start();

    // Restore durable checkpoints so the first live trade reveals any gap during downtime.
    const checkpoints = await this.prisma.marketCheckpoint.findMany().catch((e) => {
      this.logger.error(`Could not load checkpoints: ${errorMessage(e)}`);
      return [];
    });
    const bySymbol = new Map(checkpoints.map((c) => [c.symbol, Number(c.lastTradeId)]));
    this.pipelines.clear();
    for (const symbol of SUPPORTED_SYMBOLS) {
      this.pipelines.set(
        symbol,
        new SymbolPipeline(
          symbol,
          {
            process: (t) => this.processTrade(t),
            fetchFrom: (s, from, limit) => this.rest.getTradesFrom(s, from, limit),
            reportGap: (s, from, to, reason) => this.reportGap(s, from, to, reason),
            onRecovering: (s, r) => {
              this.state.setRecovering(s, r);
              if (r) this.logger.warn(`Recovering ${s} trades`);
              void this.publishStatus(true);
            },
            onDropped: (s, n) => this.logger.warn(`Processing queue full for ${s}; ${n} trades dropped (will be backfilled)`),
            onError: (s, e) => this.logger.error(`Processing ${s} failed: ${errorMessage(e)}`),
          },
          {
            maxQueue: this.config.get('MARKET_QUEUE_MAX', { infer: true }),
            maxBackfill: this.config.get('MARKET_MAX_BACKFILL_TRADES', { infer: true }),
          },
          bySymbol.get(symbol) ?? null,
        ),
      );
    }

    // REST snapshot initializes the display cache only (plan §3).
    try {
      const snapshot = await this.rest.getPriceSnapshot(SUPPORTED_SYMBOLS);
      for (const s of snapshot) this.state.recordSnapshot(s.symbol, s.price);
    } catch (e) {
      this.logger.warn(`Price snapshot failed: ${errorMessage(e)}`);
    }

    if (this.ingesting) this.provider.connect();
  }

  private async stopIngestion() {
    if (!this.ingesting) return;
    this.ingesting = false;
    this.logger.warn('Stopping market ingestion');
    this.provider.disconnect();
    await Promise.all([...this.pipelines.values()].map((p) => p.drain()));
    await this.persistCheckpoints();
    this.engine.stop();
    this.state.reset();
    this.state.leader = null;
  }

  private async processTrade(trade: MarketPrice) {
    await this.engine.evaluate(trade);
    this.state.recordTrade(trade);
    this.checkpointDirty.set(trade.symbol, trade);
  }

  private async reportGap(symbol: string, fromId: number, toId: number, reason: string) {
    this.state.unrecoveredGaps++;
    this.logger.error(`Unrecoverable trade gap ${symbol} ${fromId}-${toId}: ${reason}`);
    await this.prisma.marketGap.create({
      data: { symbol, fromTradeId: BigInt(fromId), toTradeId: BigInt(toId), reason: reason.slice(0, 500) },
    });
  }

  private async flushPrices() {
    const dirty = this.state.takeDirty();
    if (!dirty.length) return;
    try {
      const pipe = this.redis.multi();
      for (const p of dirty) pipe.set(RedisKeys.price(p.symbol), JSON.stringify(p));
      await pipe.exec();
      await this.pubsub.publish(RedisChannels.prices, dirty);
    } catch (e) {
      this.logger.warn(`Price cache flush failed: ${errorMessage(e)}`);
    }
  }

  private async persistCheckpoints() {
    if (!this.checkpointDirty.size) return;
    const items = [...this.checkpointDirty.values()];
    this.checkpointDirty.clear();
    for (const t of items) {
      try {
        const data = { lastTradeId: BigInt(t.tradeId), lastTradeTime: new Date(t.timestamp), lastPrice: t.price };
        await this.prisma.marketCheckpoint.upsert({ where: { symbol: t.symbol }, create: { symbol: t.symbol, ...data }, update: data });
        await this.redis.set(RedisKeys.checkpoint(t.symbol), JSON.stringify({ tradeId: t.tradeId, timestamp: t.timestamp }));
      } catch (e) {
        // Keep it for the next round unless something newer arrived.
        if (!this.checkpointDirty.has(t.symbol)) this.checkpointDirty.set(t.symbol, t);
        this.logger.warn(`Checkpoint persist failed for ${t.symbol}: ${errorMessage(e)}`);
      }
    }
  }

  private async publishStatus(force: boolean) {
    if (!this.ingesting && !force) return;
    const status = this.state.status();
    const { updatedAt: _ignored, ...comparable } = status;
    const json = JSON.stringify(comparable);
    const now = Date.now();
    // Always refresh the key (it doubles as a liveness signal); publish on change or every 5s.
    try {
      if (this.ingesting) await this.redis.set(RedisKeys.marketStatus, JSON.stringify(status), 'EX', STATUS_TTL_SECONDS);
      if (force || json !== this.lastStatusJson || now - this.lastStatusPublishedAt > 5_000) {
        this.lastStatusJson = json;
        this.lastStatusPublishedAt = now;
        if (this.ingesting) await this.pubsub.publish(RedisChannels.status, status);
      }
    } catch (e) {
      this.logger.warn(`Status publish failed: ${errorMessage(e)}`);
    }
  }

  async onApplicationShutdown() {
    this.timers.forEach((t) => clearInterval(t));
    await this.stopIngestion();
  }
}
