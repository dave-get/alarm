import { Decimal } from 'decimal.js';
import { AlertEngineService } from './alert-engine.service.js';
import type { MarketPrice } from '../market-data/providers/market-provider.interface.js';

type Row = {
  id: string;
  userId: string;
  symbol: string;
  targetPrice: Decimal;
  condition: 'ABOVE' | 'BELOW';
  status: 'ACTIVE' | 'TRIGGERED' | 'PAUSED' | 'CANCELLED';
  mode: 'ONCE' | 'RECURRING';
  armed: boolean;
  cooldownSeconds: number;
  rearmMarginPercent: Decimal;
  triggerCount: number;
  lastTriggeredAt: Date | null;
};

/** Minimal in-memory Prisma double that honours conditional updateMany like PostgreSQL row locks would. */
function fakePrisma(rows: Row[]) {
  const events: Record<string, unknown>[] = [];
  const outbox: Record<string, unknown>[] = [];
  const match = (r: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v);
  const priceAlert = {
    findMany: async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => match(r, where)),
    findUnique: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id)!,
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, any> }) => {
      await new Promise((r) => setTimeout(r, 1)); // let concurrent callers interleave
      const hit = rows.filter((r) => match(r, where));
      for (const r of hit) {
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === 'object' && 'increment' in v) (r as any)[k] += v.increment;
          else (r as any)[k] = v;
        }
      }
      return { count: hit.length };
    },
  };
  const tx = {
    priceAlert,
    alertEvent: { create: async ({ data }: any) => (events.push(data), { id: `ev-${events.length}`, ...data }) },
    outboxEvent: { create: async ({ data }: any) => (outbox.push(data), data) },
  };
  return {
    prisma: { priceAlert, $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) },
    events,
    outbox,
  };
}

const alert = (over: Partial<Row>): Row => ({
  id: 'a1',
  userId: 'u1',
  symbol: 'XRPUSDT',
  targetPrice: new Decimal('1.50'),
  condition: 'ABOVE',
  status: 'ACTIVE',
  mode: 'ONCE',
  armed: true,
  cooldownSeconds: 0,
  rearmMarginPercent: new Decimal('0.5'),
  triggerCount: 0,
  lastTriggeredAt: null,
  ...over,
});

let tradeId = 1000;
const trade = (price: string, ts = Date.now()): MarketPrice => ({ symbol: 'XRPUSDT', price, tradeId: ++tradeId, timestamp: ts, source: 'BINANCE' });

async function engineWith(rows: Row[]) {
  const fake = fakePrisma(rows);
  const pubsub = { subscribe: vi.fn(async () => () => undefined), publish: vi.fn(async () => undefined) };
  const state = { freshTrade: vi.fn(() => undefined) };
  const config = { get: vi.fn(() => 60_000) };
  const engine = new AlertEngineService(fake.prisma as any, pubsub as any, state as any, config as any);
  await engine.start();
  return { engine, ...fake, pubsub };
}

describe('AlertEngineService', () => {
  afterEach(() => vi.useRealTimers());

  it('waits below target, triggers at the exact target, once', async () => {
    const rows = [alert({})];
    const { engine, events, outbox, pubsub } = await engineWith(rows);
    await engine.evaluate(trade('1.45'));
    expect(events).toHaveLength(0);
    await engine.evaluate(trade('1.50'));
    await engine.evaluate(trade('1.51'));
    expect(events).toHaveLength(1);
    expect(outbox).toHaveLength(1);
    expect(rows[0].status).toBe('TRIGGERED');
    expect(String(events[0].triggeredPrice)).toBe('1.50');
    expect(pubsub.publish).toHaveBeenCalledWith('outbox:new', expect.anything());
    engine.stop();
  });

  it('triggers on a jump over the target', async () => {
    const rows = [alert({ condition: 'BELOW', targetPrice: new Decimal('1.40') })];
    const { engine, events } = await engineWith(rows);
    await engine.evaluate(trade('1.33'));
    expect(events).toHaveLength(1);
    engine.stop();
  });

  it('simultaneous trades never trigger the same alarm twice', async () => {
    const rows = [alert({})];
    const { engine, events, outbox } = await engineWith(rows);
    await Promise.all([engine.evaluate(trade('1.51')), engine.evaluate(trade('1.52')), engine.evaluate(trade('1.53'))]);
    expect(events).toHaveLength(1);
    expect(outbox).toHaveLength(1);
    engine.stop();
  });

  it('a concurrently paused alarm is not triggered (atomic conditional update)', async () => {
    const rows = [alert({})];
    const { engine, events } = await engineWith(rows);
    rows[0].status = 'PAUSED'; // changed in DB after the index was built
    await engine.evaluate(trade('1.60'));
    expect(events).toHaveLength(0);
    engine.stop();
  });

  it('RECURRING rearms only after leaving the condition by the margin and the cooldown', async () => {
    const rows = [alert({ mode: 'RECURRING', cooldownSeconds: 60, rearmMarginPercent: new Decimal('1') })];
    const { engine, events } = await engineWith(rows);
    const t0 = 1_800_000_000_000;
    await engine.evaluate(trade('1.50', t0));
    expect(events).toHaveLength(1);
    expect(rows[0].armed).toBe(false);

    await engine.evaluate(trade('1.55', t0 + 1_000)); // still in condition: nothing
    await engine.evaluate(trade('1.40', t0 + 2_000)); // left by margin but cooldown not elapsed
    expect(rows[0].armed).toBe(false);
    await engine.evaluate(trade('1.484', t0 + 61_000)); // 1.484 < 1.485 (1% margin) after cooldown
    expect(rows[0].armed).toBe(true);
    await engine.evaluate(trade('1.50', t0 + 62_000));
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.sequence)).toEqual([1, 2]);
    expect(rows[0].status).toBe('ACTIVE');
    engine.stop();
  });

  it('evaluates many alarms on one trade', async () => {
    const rows = [
      alert({ id: 'x1', targetPrice: new Decimal('1.40') }),
      alert({ id: 'x2', targetPrice: new Decimal('1.50') }),
      alert({ id: 'x3', targetPrice: new Decimal('1.60') }),
      alert({ id: 'x4', condition: 'BELOW', targetPrice: new Decimal('1.55') }),
    ];
    const { engine, events } = await engineWith(rows);
    await engine.evaluate(trade('1.55'));
    expect(events.map((e) => e.alertId).sort()).toEqual(['x1', 'x2', 'x4']);
    engine.stop();
  });
});
