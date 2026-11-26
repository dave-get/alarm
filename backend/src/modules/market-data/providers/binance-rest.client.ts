import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { AppConfig } from '../../../config/configuration.js';
import { restAggTradeSchema, restTickerSchema } from './binance-event.schema.js';
import type { MarketPrice, MarketRestClient } from './market-provider.interface.js';

export class BinanceHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Binance public market data REST (plan §3). No API key required. */
@Injectable()
export class BinanceRestClient implements MarketRestClient {
  private readonly baseUrl: string;

  constructor(config: ConfigService<AppConfig, true>) {
    this.baseUrl = config.get('BINANCE_REST_URL', { infer: true }).replace(/\/$/, '');
  }

  async getPriceSnapshot(symbols: readonly string[]) {
    // URL-encode the JSON array parameter.
    const qs = new URLSearchParams({ symbols: JSON.stringify(symbols) });
    const body = await this.get(`/api/v3/ticker/price?${qs.toString()}`);
    return restTickerSchema.parse(body);
  }

  async getTradesFrom(symbol: string, fromId: number, limit: number): Promise<MarketPrice[]> {
    const qs = new URLSearchParams({ symbol, fromId: String(fromId), limit: String(Math.min(1000, limit)) });
    const body = await this.get(`/api/v3/aggTrades?${qs.toString()}`);
    return z
      .array(restAggTradeSchema)
      .parse(body)
      .map((t) => ({ symbol, price: t.p, tradeId: t.a, timestamp: t.T, source: 'BINANCE' }));
  }

  private async get(path: string): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BinanceHttpError(res.status, `Binance REST ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }
}
