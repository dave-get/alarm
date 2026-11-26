import type { MarketPrice } from './providers/market-provider.interface.js';

export interface SymbolPipelineDeps {
  /** Evaluate and record one trade. Called strictly in trade-ID order, one at a time. */
  process(trade: MarketPrice): Promise<void>;
  /** REST backfill page: aggregate trades from `fromId` (inclusive), ascending. */
  fetchFrom(symbol: string, fromId: number, limit: number): Promise<MarketPrice[]>;
  /** Explicitly record trades that could not be recovered. */
  reportGap(symbol: string, fromId: number, toId: number, reason: string): Promise<void>;
  onRecovering?(symbol: string, recovering: boolean): void;
  onDropped?(symbol: string, dropped: number): void;
  onError?(symbol: string, error: unknown): void;
}

export interface SymbolPipelineOptions {
  maxQueue: number;
  maxBackfill: number;
  fetchAttempts?: number;
  fetchRetryBaseMs?: number;
}

/**
 * Ordered, bounded, gap-aware processing for one symbol (plan §3, §8, §12):
 *
 * - Every accepted trade is evaluated; nothing is throttled before evaluation.
 * - Aggregate trade IDs are sequential per symbol, so `id <= last` is a duplicate or
 *   out-of-order replay (dropped), and `id > last + 1` is a gap.
 * - A gap is backfilled from REST, paginated, deduplicated and replayed in order
 *   before the trade that revealed it. Live trades arriving meanwhile wait in the queue
 *   (the recovery buffer).
 * - The queue is bounded. On overflow the newest trades are dropped: the next accepted
 *   trade then reveals a gap and the dropped trades are backfilled, so evaluation stays
 *   complete without unbounded memory.
 * - Unrecoverable ranges are reported, never silently skipped.
 */
export class SymbolPipeline {
  lastTradeId: number | null;
  duplicates = 0;
  dropped = 0;
  private readonly queue: MarketPrice[] = [];
  private running = false;
  private idleWaiters: (() => void)[] = [];

  constructor(
    readonly symbol: string,
    private readonly deps: SymbolPipelineDeps,
    private readonly options: SymbolPipelineOptions,
    lastTradeId: number | null = null,
  ) {
    this.lastTradeId = lastTradeId;
  }

  get queueLength() {
    return this.queue.length;
  }

  push(trade: MarketPrice) {
    if (this.queue.length >= this.options.maxQueue) {
      this.dropped++;
      if (this.dropped % 1000 === 1) this.deps.onDropped?.(this.symbol, this.dropped);
      return;
    }
    this.queue.push(trade);
    if (!this.running) void this.run();
  }

  /** Resolves once the queue is empty and nothing is processing (tests, shutdown). */
  drain(): Promise<void> {
    if (!this.running && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private async run() {
    this.running = true;
    try {
      while (this.queue.length) {
        const trade = this.queue.shift()!;
        await this.handle(trade);
      }
    } finally {
      this.running = false;
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      waiters.forEach((w) => w());
    }
  }

  private async handle(trade: MarketPrice) {
    const last = this.lastTradeId;
    if (last !== null && trade.tradeId <= last) {
      this.duplicates++;
      return;
    }
    if (last !== null && trade.tradeId > last + 1) {
      await this.recover(last + 1, trade.tradeId - 1);
    }
    // Recovery may already have covered this trade.
    if (this.lastTradeId !== null && trade.tradeId <= this.lastTradeId) return;
    await this.apply(trade);
  }

  private async apply(trade: MarketPrice) {
    try {
      await this.deps.process(trade);
    } catch (error) {
      this.deps.onError?.(this.symbol, error);
    }
    this.lastTradeId = trade.tradeId;
  }

  private async recover(fromId: number, toId: number) {
    this.deps.onRecovering?.(this.symbol, true);
    let next = fromId;
    try {
      const missing = toId - fromId + 1;
      if (missing > this.options.maxBackfill) {
        await this.deps.reportGap(this.symbol, fromId, toId, `BACKFILL_LIMIT_EXCEEDED (${missing} trades)`);
        this.lastTradeId = toId;
        return;
      }
      while (next <= toId) {
        const page = await this.fetchWithRetry(next, Math.min(1000, toId - next + 1));
        const before = next;
        for (const t of [...page].sort((a, b) => a.tradeId - b.tradeId)) {
          if (t.tradeId < next) continue; // duplicate within/between pages
          if (t.tradeId > toId) break; // live stream covers the rest
          if (t.tradeId > next) {
            // The exchange itself skipped IDs inside the page.
            await this.deps.reportGap(this.symbol, next, t.tradeId - 1, 'TRADES_NOT_RETURNED');
          }
          await this.apply(t);
          next = t.tradeId + 1;
        }
        if (next === before) break; // no progress: avoid looping forever
      }
      if (next <= toId) {
        await this.deps.reportGap(this.symbol, next, toId, 'TRADES_NOT_RETURNED');
        this.lastTradeId = toId;
      }
    } catch (error) {
      await this.deps
        .reportGap(this.symbol, next, toId, `BACKFILL_FAILED: ${error instanceof Error ? error.message : String(error)}`)
        .catch(() => undefined);
      this.lastTradeId = Math.max(this.lastTradeId ?? toId, toId);
    } finally {
      this.deps.onRecovering?.(this.symbol, false);
    }
  }

  private async fetchWithRetry(fromId: number, limit: number): Promise<MarketPrice[]> {
    const attempts = this.options.fetchAttempts ?? 4;
    const base = this.options.fetchRetryBaseMs ?? 500;
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await this.deps.fetchFrom(this.symbol, fromId, limit);
      } catch (error) {
        lastError = error;
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, base * 2 ** i + Math.random() * base));
      }
    }
    throw lastError;
  }
}
