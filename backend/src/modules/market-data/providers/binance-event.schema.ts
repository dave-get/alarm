import { z } from 'zod';
import { SUPPORTED_SYMBOLS } from '../../../common/enums/symbols.enum.js';
import type { MarketPrice } from './market-provider.interface.js';

const decimal = z.string().regex(/^\d+(\.\d+)?$/);

/** Plan §5 "schema validation": the combined-stream aggTrade envelope. */
export const aggTradeStreamSchema = z.object({
  stream: z.string(),
  data: z.object({
    e: z.literal('aggTrade'),
    E: z.number().int(),
    s: z.enum(SUPPORTED_SYMBOLS),
    a: z.number().int().nonnegative(),
    p: decimal,
    q: decimal,
    T: z.number().int().positive(),
    m: z.boolean(),
  }),
});

/** REST /api/v3/aggTrades row. */
export const restAggTradeSchema = z.object({
  a: z.number().int().nonnegative(),
  p: decimal,
  q: decimal,
  T: z.number().int().positive(),
  m: z.boolean(),
});

export const restTickerSchema = z.array(z.object({ symbol: z.string(), price: decimal }));

export type ParseResult = { ok: true; price: MarketPrice } | { ok: false; reason: 'invalid' | 'ignored' };

/** Parse one raw WebSocket frame. Never throws. */
export function parseAggTradeMessage(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  // Subscription acks and other non-trade frames are ignored, not errors.
  if (!json || typeof json !== 'object' || !('data' in json)) return { ok: false, reason: 'ignored' };
  const parsed = aggTradeStreamSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: 'invalid' };
  const d = parsed.data.data;
  return { ok: true, price: { symbol: d.s, price: d.p, tradeId: d.a, timestamp: d.T, source: 'BINANCE' } };
}
