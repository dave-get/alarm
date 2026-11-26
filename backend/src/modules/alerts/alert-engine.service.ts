import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from 'decimal.js';
import type { AppConfig } from '../../config/configuration.js';
import { OutboxEventTypes } from '../../common/enums/alert.enums.js';
import type { PriceAlert } from '../../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { RedisChannels } from '../redis/redis.constants.js';
import { RedisPubSubService } from '../redis/redis-pubsub.service.js';
import { MarketStateService } from '../market-data/market-state.service.js';
import type { MarketPrice } from '../market-data/providers/market-provider.interface.js';
import { rearmThreshold, shouldTrigger, type Condition } from './alert-condition.js';
import { ThresholdIndex } from './threshold-index.js';

export interface IndexedAlert {
  id: string;
  userId: string;
  symbol: string;
  condition: Condition;
  mode: 'ONCE' | 'RECURRING';
  targetPrice: string;
  cooldownMs: number;
  rearmMarginPercent: string;
  lastTriggeredAt: number | null;
}

class SymbolIndex {
  /** Armed ABOVE alarms keyed by target: fire when target <= price. */
  readonly above = new ThresholdIndex<IndexedAlert>();
  /** Armed BELOW alarms keyed by target: fire when target >= price. */
  readonly below = new ThresholdIndex<IndexedAlert>();
  /** Disarmed RECURRING ABOVE alarms keyed by rearm level: rearm when level > price. */
  readonly rearmAbove = new ThresholdIndex<IndexedAlert>();
  /** Disarmed RECURRING BELOW alarms keyed by rearm level: rearm when level < price. */
  readonly rearmBelow = new ThresholdIndex<IndexedAlert>();

  remove(id: string) {
    this.above.remove(id);
    this.below.remove(id);
    this.rearmAbove.remove(id);
    this.rearmBelow.remove(id);
  }

  get size() {
    return this.above.size + this.below.size + this.rearmAbove.size + this.rearmBelow.size;
  }
}

/**
 * Plan §6 and §8. Evaluates every accepted trade against an in-memory threshold
 * index of active alarms, restored from PostgreSQL on start, synchronized through
 * Redis pub/sub when alarms change, and periodically resynchronized.
 *
 * Duplicate prevention: an alarm is removed from the index synchronously before any
 * await (simultaneous trades can't both pick it), and the trigger is an atomic
 * conditional UPDATE ... WHERE status = 'ACTIVE' AND armed, committed together with the
 * alert event and outbox row. If the update matches nothing, nothing is emitted.
 */
@Injectable()
export class AlertEngineService implements OnModuleDestroy {
  private readonly logger = new Logger(AlertEngineService.name);
  private readonly index = new Map<string, SymbolIndex>();
  private active = false;
  private resyncTimer?: NodeJS.Timeout;
  private unsubscribe?: () => void;
  private generation = 0;
  triggered = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pubsub: RedisPubSubService,
    private readonly state: MarketStateService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  get alertCount() {
    let n = 0;
    for (const i of this.index.values()) n += i.size;
    return n;
  }

  /** Restore active alarms and start following changes (called when this instance leads ingestion). */
  async start() {
    this.active = true;
    if (!this.unsubscribe) {
      this.unsubscribe = await this.pubsub.subscribe(RedisChannels.alertChanged, (msg) => {
        const id = (msg as { alertId?: unknown })?.alertId;
        if (typeof id === 'string') void this.refreshAlert(id);
      });
    }
    await this.resync();
    clearInterval(this.resyncTimer);
    this.resyncTimer = setInterval(() => void this.resync(), this.config.get('ALERT_RESYNC_INTERVAL_MS', { infer: true }));
  }

  stop() {
    this.active = false;
    clearInterval(this.resyncTimer);
    this.index.clear();
  }

  onModuleDestroy() {
    this.stop();
    this.unsubscribe?.();
  }

  /** Full rebuild from the database (start, and periodically to heal missed pub/sub messages). */
  async resync() {
    if (!this.active) return;
    const gen = ++this.generation;
    try {
      const rows = await this.prisma.priceAlert.findMany({ where: { status: 'ACTIVE' } });
      if (gen !== this.generation || !this.active) return;
      const next = new Map<string, SymbolIndex>();
      for (const row of rows) this.place(next, toIndexed(row), row.armed);
      this.index.clear();
      for (const [k, v] of next) this.index.set(k, v);
      this.logger.log(`Alert index synchronized: ${rows.length} active alarms`);
    } catch (error) {
      this.logger.error(`Alert resync failed: ${(error as Error).message}`);
    }
  }

  /** One alarm changed (created, updated, paused, resumed, cancelled). */
  async refreshAlert(alertId: string) {
    if (!this.active) return;
    try {
      const row = await this.prisma.priceAlert.findUnique({ where: { id: alertId } });
      for (const idx of this.index.values()) idx.remove(alertId);
      if (!row || row.status !== 'ACTIVE') return;
      const alert = toIndexed(row);
      this.place(this.index, alert, row.armed);
      // Plan §6: a fresh price that already satisfies a new alarm triggers it right after creation.
      const fresh = row.armed ? this.state.freshTrade(row.symbol) : undefined;
      if (fresh && shouldTrigger(fresh.price, alert.targetPrice, alert.condition)) {
        this.index.get(row.symbol)?.remove(alert.id);
        await this.trigger(alert, fresh);
      }
    } catch (error) {
      this.logger.error(`Alert refresh failed for ${alertId}: ${(error as Error).message}`);
    }
  }

  /** Evaluate one accepted trade. Never throttled (plan §8). */
  async evaluate(trade: MarketPrice) {
    if (!this.active) return;
    const idx = this.index.get(trade.symbol);
    if (!idx) return;
    const price = new Decimal(trade.price);

    const hits = [...idx.above.lte(price), ...idx.below.gte(price)];
    for (const a of hits) idx.remove(a.id);

    const rearms = [...idx.rearmAbove.gt(price), ...idx.rearmBelow.lt(price)].filter(
      (a) => a.lastTriggeredAt === null || trade.timestamp - a.lastTriggeredAt >= a.cooldownMs,
    );
    for (const a of rearms) idx.remove(a.id);

    if (!hits.length && !rearms.length) return;
    await Promise.all([...hits.map((a) => this.trigger(a, trade)), ...rearms.map((a) => this.rearm(a))]);
  }

  private async trigger(alert: IndexedAlert, trade: MarketPrice) {
    const triggeredAt = new Date(trade.timestamp);
    try {
      const event = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.priceAlert.updateMany({
          where: { id: alert.id, status: 'ACTIVE', armed: true },
          data: {
            ...(alert.mode === 'ONCE' ? { status: 'TRIGGERED' as const } : {}),
            armed: false,
            triggeredPrice: trade.price,
            triggeredAt,
            lastTriggeredAt: triggeredAt,
            triggerCount: { increment: 1 },
          },
        });
        if (updated.count !== 1) return null;
        const row = await tx.priceAlert.findUniqueOrThrow({ where: { id: alert.id }, select: { triggerCount: true } });
        const ev = await tx.alertEvent.create({
          data: {
            alertId: alert.id,
            userId: alert.userId,
            sequence: row.triggerCount,
            symbol: alert.symbol,
            condition: alert.condition,
            targetPrice: alert.targetPrice,
            triggeredPrice: trade.price,
            triggeredAt,
            tradeId: BigInt(trade.tradeId),
          },
        });
        await tx.outboxEvent.create({
          data: {
            eventType: OutboxEventTypes.alertTriggered,
            aggregateId: ev.id,
            payload: {
              alertEventId: ev.id,
              alertId: alert.id,
              userId: alert.userId,
              symbol: alert.symbol,
              condition: alert.condition,
              mode: alert.mode,
              targetPrice: alert.targetPrice,
              triggeredPrice: trade.price,
              triggeredAt: triggeredAt.toISOString(),
              tradeId: String(trade.tradeId),
              sequence: row.triggerCount,
            },
          },
        });
        return ev;
      });

      if (!event) {
        // Someone else changed it (paused, cancelled, already triggered): resync this alarm.
        await this.refreshAlert(alert.id);
        return;
      }
      this.triggered++;
      this.logger.log('Alert triggered', { alertId: alert.id, symbol: alert.symbol, price: trade.price, tradeId: trade.tradeId });
      if (alert.mode === 'RECURRING' && this.active) {
        this.placeDisarmed(this.index, { ...alert, lastTriggeredAt: trade.timestamp });
      }
      void this.pubsub.publish(RedisChannels.outboxNew, { id: event.id }).catch(() => undefined);
    } catch (error) {
      // Not committed: put it back so the next trade retries. The conditional update prevents duplicates.
      this.logger.error(`Trigger failed for ${alert.id}: ${(error as Error).message}`);
      if (this.active) this.place(this.index, alert, true);
    }
  }

  private async rearm(alert: IndexedAlert) {
    try {
      const res = await this.prisma.priceAlert.updateMany({
        where: { id: alert.id, status: 'ACTIVE', armed: false },
        data: { armed: true },
      });
      if (res.count === 1) {
        if (this.active) this.place(this.index, alert, true);
      } else {
        await this.refreshAlert(alert.id);
      }
    } catch (error) {
      this.logger.error(`Rearm failed for ${alert.id}: ${(error as Error).message}`);
      if (this.active) this.placeDisarmed(this.index, alert);
    }
  }

  private place(target: Map<string, SymbolIndex>, alert: IndexedAlert, armed: boolean) {
    if (!armed) {
      if (alert.mode === 'RECURRING') this.placeDisarmed(target, alert);
      return;
    }
    const idx = this.symbolIndex(target, alert.symbol);
    idx.remove(alert.id);
    (alert.condition === 'ABOVE' ? idx.above : idx.below).add(alert.id, alert.targetPrice, alert);
  }

  private placeDisarmed(target: Map<string, SymbolIndex>, alert: IndexedAlert) {
    const idx = this.symbolIndex(target, alert.symbol);
    idx.remove(alert.id);
    const level = rearmThreshold(alert.targetPrice, alert.condition, alert.rearmMarginPercent);
    (alert.condition === 'ABOVE' ? idx.rearmAbove : idx.rearmBelow).add(alert.id, level, alert);
  }

  private symbolIndex(target: Map<string, SymbolIndex>, symbol: string) {
    let idx = target.get(symbol);
    if (!idx) {
      idx = new SymbolIndex();
      target.set(symbol, idx);
    }
    return idx;
  }
}

export function toIndexed(row: PriceAlert): IndexedAlert {
  return {
    id: row.id,
    userId: row.userId,
    symbol: row.symbol,
    condition: row.condition,
    mode: row.mode,
    targetPrice: row.targetPrice.toString(),
    cooldownMs: row.cooldownSeconds * 1000,
    rearmMarginPercent: row.rearmMarginPercent.toString(),
    lastTriggeredAt: row.lastTriggeredAt ? row.lastTriggeredAt.getTime() : null,
  };
}
