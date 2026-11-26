import type { CryptoSymbol } from '../../../common/enums/symbols.enum.js';
import type { MarketPrice } from '../providers/market-provider.interface.js';

export type MarketConnection = 'CONNECTING' | 'CONNECTED' | 'RECOVERING' | 'DISCONNECTED' | 'UNAVAILABLE';

export interface SymbolStatus {
  stale: boolean;
  recovering: boolean;
  lastTradeId: number | null;
  lastTradeAt: number | null;
  lastReceivedAt: number | null;
}

/** Published by the market worker; read by the API and health checks. */
export interface MarketStatus {
  connection: MarketConnection;
  source: string;
  leader: string | null;
  updatedAt: number;
  symbols: Partial<Record<CryptoSymbol, SymbolStatus>>;
  unrecoveredGaps: number;
}

/** Latest price as cached in Redis and broadcast to clients. */
export interface CachedPrice extends MarketPrice {
  receivedAt: number;
}

export interface PriceView {
  symbol: string;
  price: string | null;
  source: string;
  timestamp: number | null;
  tradeId: number | null;
  isStale: boolean;
}
