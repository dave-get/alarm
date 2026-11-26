import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration.js';
import { SUPPORTED_SYMBOLS, type CryptoSymbol } from '../../common/enums/symbols.enum.js';
import type { CachedPrice, MarketConnection, MarketStatus, SymbolStatus } from './interfaces/market.interfaces.js';
import type { MarketPrice } from './providers/market-provider.interface.js';

/**
 * In-process market state of the ingestion worker: latest accepted trade per symbol,
 * freshness, recovery and connection state. Shared by ingestion and the alert engine.
 */
@Injectable()
export class MarketStateService {
  private readonly latest = new Map<string, CachedPrice>();
  private readonly symbols = new Map<string, SymbolStatus>();
  private readonly dirty = new Set<string>();
  private readonly staleAfter: number;
  connection: MarketConnection = 'DISCONNECTED';
  leader: string | null = null;
  unrecoveredGaps = 0;

  constructor(config: ConfigService<AppConfig, true>) {
    this.staleAfter = config.get('MARKET_STALE_AFTER_MS', { infer: true });
    for (const s of SUPPORTED_SYMBOLS) {
      this.symbols.set(s, { stale: true, recovering: false, lastTradeId: null, lastTradeAt: null, lastReceivedAt: null });
    }
  }

  /** A trade was evaluated: it becomes the latest price if newer. */
  recordTrade(trade: MarketPrice, receivedAt = Date.now()) {
    const st = this.symbols.get(trade.symbol);
    if (!st) return;
    st.lastTradeId = trade.tradeId;
    st.lastTradeAt = trade.timestamp;
    // Backfilled (historical) trades don't make the price fresh.
    if (Date.now() - trade.timestamp < this.staleAfter) {
      st.lastReceivedAt = receivedAt;
      st.stale = false;
    }
    const prev = this.latest.get(trade.symbol);
    if (!prev || prev.source !== 'BINANCE' || trade.tradeId > prev.tradeId) {
      this.latest.set(trade.symbol, { ...trade, receivedAt });
      this.dirty.add(trade.symbol);
    }
  }

  /** REST snapshot used only to initialize the display cache; never evaluated against alarms. */
  recordSnapshot(symbol: string, price: string) {
    if (this.latest.has(symbol)) return;
    const now = Date.now();
    this.latest.set(symbol, { symbol, price, tradeId: 0, timestamp: now, source: 'BINANCE_REST', receivedAt: now });
    this.dirty.add(symbol);
  }

  setRecovering(symbol: string, recovering: boolean) {
    const st = this.symbols.get(symbol);
    if (st) st.recovering = recovering;
  }

  /** Re-evaluates staleness; returns symbols whose stale flag changed. */
  refreshStaleness(now = Date.now()): string[] {
    const changed: string[] = [];
    for (const [symbol, st] of this.symbols) {
      const stale = st.lastReceivedAt === null || now - st.lastReceivedAt > this.staleAfter || this.connection === 'UNAVAILABLE';
      if (stale !== st.stale) {
        st.stale = stale;
        changed.push(symbol);
        this.dirty.add(symbol);
      }
    }
    return changed;
  }

  isFresh(symbol: string): boolean {
    const st = this.symbols.get(symbol);
    return !!st && !st.stale && !st.recovering;
  }

  /** The latest live trade, only if fresh (plan §12: suspend stale-price evaluation). */
  freshTrade(symbol: string): CachedPrice | undefined {
    const p = this.latest.get(symbol);
    return p && p.source === 'BINANCE' && this.isFresh(symbol) ? p : undefined;
  }

  takeDirty(): (CachedPrice & { isStale: boolean })[] {
    const out: (CachedPrice & { isStale: boolean })[] = [];
    for (const symbol of this.dirty) {
      const p = this.latest.get(symbol);
      if (p) out.push({ ...p, isStale: !this.isFresh(symbol) });
    }
    this.dirty.clear();
    return out;
  }

  status(): MarketStatus {
    const recovering = [...this.symbols.values()].some((s) => s.recovering);
    const symbols: MarketStatus['symbols'] = {};
    for (const [k, v] of this.symbols) symbols[k as CryptoSymbol] = { ...v };
    return {
      connection: this.connection === 'CONNECTED' && recovering ? 'RECOVERING' : this.connection,
      source: 'BINANCE',
      leader: this.leader,
      updatedAt: Date.now(),
      symbols,
      unrecoveredGaps: this.unrecoveredGaps,
    };
  }

  reset() {
    this.latest.clear();
    this.dirty.clear();
    for (const st of this.symbols.values()) Object.assign(st, { stale: true, recovering: false, lastReceivedAt: null });
  }
}
