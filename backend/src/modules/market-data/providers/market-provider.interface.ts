export { SUPPORTED_SYMBOLS, type CryptoSymbol } from '../../../common/enums/symbols.enum.js';

/** A normalized, executed trade price (plan §5). Prices are decimal strings, never floats. */
export interface MarketPrice {
  symbol: string;
  price: string;
  tradeId: number;
  timestamp: number;
  source: string;
}

export type ProviderConnectionState = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED';

/** Keep the exchange replaceable (plan §17): everything downstream depends on this interface only. */
export interface MarketProvider {
  connect(): void;
  disconnect(): void;
  onPrice(handler: (price: MarketPrice) => void): void;
  onConnectionChange(handler: (state: ProviderConnectionState) => void): void;
}

/** REST access for initialization and recovery (plan §3). */
export interface MarketRestClient {
  /** Latest price snapshot for the given symbols (not trades: never used to evaluate alarms). */
  getPriceSnapshot(symbols: readonly string[]): Promise<{ symbol: string; price: string }[]>;
  /** Aggregate trades starting at fromId (inclusive), ascending, at most `limit`. */
  getTradesFrom(symbol: string, fromId: number, limit: number): Promise<MarketPrice[]>;
}

export const MARKET_PROVIDER = Symbol('MARKET_PROVIDER');
export const MARKET_REST_CLIENT = Symbol('MARKET_REST_CLIENT');
