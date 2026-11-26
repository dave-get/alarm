import { parseAggTradeMessage } from './binance-event.schema.js';

describe('parseAggTradeMessage', () => {
  it('normalizes the plan §3 example event', () => {
    const raw =
      '{"stream":"xrpusdt@aggTrade","data":{"e":"aggTrade","E":1795698000000,"s":"XRPUSDT","a":123456789,"p":"1.45000000","q":"250.00000000","T":1795698000000,"m":false}}';
    expect(parseAggTradeMessage(raw)).toEqual({
      ok: true,
      price: { symbol: 'XRPUSDT', price: '1.45000000', tradeId: 123456789, timestamp: 1795698000000, source: 'BINANCE' },
    });
  });

  it('rejects malformed JSON, wrong types and unsupported symbols', () => {
    expect(parseAggTradeMessage('not json')).toEqual({ ok: false, reason: 'invalid' });
    const bad = (data: object) => JSON.stringify({ stream: 's', data: { e: 'aggTrade', E: 1, s: 'XRPUSDT', a: 1, p: '1.0', q: '1', T: 1, m: false, ...data } });
    expect(parseAggTradeMessage(bad({ p: 1.45 })).ok).toBe(false);
    expect(parseAggTradeMessage(bad({ p: '-1' })).ok).toBe(false);
    expect(parseAggTradeMessage(bad({ s: 'DOGEUSDT' })).ok).toBe(false);
    expect(parseAggTradeMessage(bad({ a: 'x' })).ok).toBe(false);
  });

  it('ignores non-trade frames', () => {
    expect(parseAggTradeMessage('{"result":null,"id":1}')).toEqual({ ok: false, reason: 'ignored' });
  });
});
