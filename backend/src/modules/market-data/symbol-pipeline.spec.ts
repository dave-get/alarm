import { SymbolPipeline, type SymbolPipelineDeps } from './symbol-pipeline.js';
import type { MarketPrice } from './providers/market-provider.interface.js';

const t = (id: number, price = '1.0'): MarketPrice => ({ symbol: 'XRPUSDT', price, tradeId: id, timestamp: 1_800_000_000_000 + id, source: 'BINANCE' });

function setup(opts: { last?: number | null; history?: MarketPrice[]; failFetch?: boolean; maxQueue?: number; maxBackfill?: number } = {}) {
  const processed: number[] = [];
  const gaps: [number, number, string][] = [];
  const fetches: [number, number][] = [];
  const history = opts.history ?? [];
  const deps: SymbolPipelineDeps = {
    process: async (tr) => {
      processed.push(tr.tradeId);
    },
    fetchFrom: async (_s, from, limit) => {
      fetches.push([from, limit]);
      if (opts.failFetch) throw new Error('HTTP 503');
      return history.filter((h) => h.tradeId >= from).slice(0, limit);
    },
    reportGap: async (_s, from, to, reason) => {
      gaps.push([from, to, reason]);
    },
  };
  const p = new SymbolPipeline('XRPUSDT', deps, { maxQueue: opts.maxQueue ?? 100, maxBackfill: opts.maxBackfill ?? 10_000, fetchAttempts: 2, fetchRetryBaseMs: 1 }, opts.last ?? null);
  return { p, processed, gaps, fetches };
}

describe('SymbolPipeline', () => {
  it('processes in order and drops duplicates and out-of-order replays', async () => {
    const { p, processed } = setup();
    [1, 2, 2, 3, 1, 4].forEach((id) => p.push(t(id)));
    await p.drain();
    expect(processed).toEqual([1, 2, 3, 4]);
    expect(p.duplicates).toBe(2);
  });

  it('backfills a gap from REST before the trade that revealed it', async () => {
    const history = Array.from({ length: 20 }, (_, i) => t(i + 1));
    const { p, processed, gaps } = setup({ last: 5, history });
    p.push(t(10));
    p.push(t(11));
    await p.drain();
    expect(processed).toEqual([6, 7, 8, 9, 10, 11]);
    expect(gaps).toEqual([]);
  });

  it('paginates long gaps (1000 per page)', async () => {
    const history = Array.from({ length: 2600 }, (_, i) => t(i + 1));
    const { p, processed, fetches } = setup({ last: 0, history });
    p.push(t(2600));
    await p.drain();
    expect(processed).toHaveLength(2600);
    expect(processed.every((id, i) => id === i + 1)).toBe(true);
    expect(fetches.map((f) => f[0])).toEqual([1, 1001, 2001]);
  });

  it('reports unrecoverable gaps explicitly and continues', async () => {
    const { p, processed, gaps } = setup({ last: 5, failFetch: true });
    p.push(t(9));
    await p.drain();
    expect(gaps).toHaveLength(1);
    expect(gaps[0].slice(0, 2)).toEqual([6, 8]);
    expect(gaps[0][2]).toMatch(/BACKFILL_FAILED/);
    expect(processed).toEqual([9]);
  });

  it('reports gaps larger than the backfill limit', async () => {
    const { p, gaps, fetches } = setup({ last: 5, maxBackfill: 10 });
    p.push(t(100));
    await p.drain();
    expect(fetches).toHaveLength(0);
    expect(gaps[0][2]).toMatch(/BACKFILL_LIMIT_EXCEEDED/);
  });

  it('reports trades the exchange did not return', async () => {
    const history = [t(6), t(8)];
    const { p, processed, gaps } = setup({ last: 5, history });
    p.push(t(9));
    await p.drain();
    expect(processed).toEqual([6, 8, 9]);
    expect(gaps.map((g) => g.slice(0, 2))).toEqual([[7, 7]]);
  });

  it('bounded queue: dropped trades are recovered through backfill', async () => {
    const history = Array.from({ length: 50 }, (_, i) => t(i + 1));
    const { p, processed } = setup({ last: 0, history, maxQueue: 3 });
    for (let id = 1; id <= 10; id++) p.push(t(id)); // 1 starts processing, 2..4 queued, 5..10 dropped
    await p.drain();
    expect(p.dropped).toBe(6);
    expect(processed).toEqual([1, 2, 3, 4]);
    p.push(t(11)); // reveals the gap 4..10
    await p.drain();
    expect(processed).toEqual(Array.from({ length: 11 }, (_, i) => i + 1));
  });
});
