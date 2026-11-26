import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { SUPPORTED_SYMBOLS, SYMBOL_META, isSupportedSymbol, type CryptoSymbol } from '../../common/enums/symbols.enum.js';
import { REDIS_CLIENT, RedisKeys } from '../redis/redis.constants.js';
import type { CachedPrice, MarketStatus, PriceView } from './interfaces/market.interfaces.js';

/** If the market worker hasn't refreshed its status for this long, the feed is unavailable. */
const STATUS_MAX_AGE_MS = 15_000;

/** Read side used by the API process (REST + gateway). Never invents prices (plan §12). */
@Injectable()
export class MarketDataService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  getSymbols() {
    return SUPPORTED_SYMBOLS.map((symbol) => ({ symbol, ...SYMBOL_META[symbol] }));
  }

  async getStatus(): Promise<MarketStatus> {
    const raw = await this.redis.get(RedisKeys.marketStatus);
    const status = raw ? (JSON.parse(raw) as MarketStatus) : null;
    if (!status || Date.now() - status.updatedAt > STATUS_MAX_AGE_MS) {
      return {
        connection: 'UNAVAILABLE',
        source: 'BINANCE',
        leader: null,
        updatedAt: status?.updatedAt ?? 0,
        symbols: status?.symbols ?? {},
        unrecoveredGaps: status?.unrecoveredGaps ?? 0,
      };
    }
    return status;
  }

  async getPrices(): Promise<PriceView[]> {
    const [status, values] = await Promise.all([
      this.getStatus(),
      this.redis.mget(...SUPPORTED_SYMBOLS.map((s) => RedisKeys.price(s))),
    ]);
    return SUPPORTED_SYMBOLS.map((symbol, i) => this.view(symbol, values[i], status));
  }

  async getPrice(symbol: string): Promise<PriceView> {
    const upper = symbol.toUpperCase();
    if (!isSupportedSymbol(upper)) throw new BadRequestException(`Unsupported symbol. Supported: ${SUPPORTED_SYMBOLS.join(', ')}`);
    const [status, raw] = await Promise.all([this.getStatus(), this.redis.get(RedisKeys.price(upper))]);
    return this.view(upper, raw, status);
  }

  isStale(symbol: string, status: MarketStatus): boolean {
    if (status.connection === 'UNAVAILABLE') return true;
    const s = status.symbols[symbol as CryptoSymbol];
    return !s || s.stale || s.recovering;
  }

  view(symbol: string, raw: string | null, status: MarketStatus): PriceView {
    if (!raw) return { symbol, price: null, source: 'BINANCE', timestamp: null, tradeId: null, isStale: true };
    const p = JSON.parse(raw) as CachedPrice;
    return { symbol, price: p.price, source: p.source, timestamp: p.timestamp, tradeId: p.tradeId || null, isStale: this.isStale(symbol, status) };
  }
}
