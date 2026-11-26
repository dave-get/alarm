import { Decimal } from 'decimal.js';
import { ThresholdIndex } from './threshold-index.js';

describe('ThresholdIndex', () => {
  const build = () => {
    const idx = new ThresholdIndex<string>();
    for (const [id, key] of [
      ['a', '1.50'],
      ['b', '1.40'],
      ['c', '1.60'],
      ['d', '1.50'],
    ]) idx.add(id, key, id);
    return idx;
  };

  it('answers inclusive and strict range queries', () => {
    const idx = build();
    const p = new Decimal('1.5');
    expect(idx.lte(p).sort()).toEqual(['a', 'b', 'd']);
    expect(idx.lt(p)).toEqual(['b']);
    expect(idx.gte(p).sort()).toEqual(['a', 'c', 'd']);
    expect(idx.gt(p)).toEqual(['c']);
  });

  it('removes and re-adds by id', () => {
    const idx = build();
    idx.remove('a');
    idx.add('d', '1.70', 'd');
    expect(idx.size).toBe(3);
    expect(idx.gte(new Decimal('1.65'))).toEqual(['d']);
    expect(idx.has('a')).toBe(false);
  });

  it('stays sorted for many random keys', () => {
    const idx = new ThresholdIndex<number>();
    const keys = Array.from({ length: 500 }, (_, i) => ({ i, k: (Math.random() * 1000).toFixed(6) }));
    keys.forEach(({ i, k }) => idx.add(String(i), k, i));
    const probe = new Decimal('500');
    const expected = keys.filter(({ k }) => new Decimal(k).lte(probe)).map(({ i }) => i).sort((a, b) => a - b);
    expect(idx.lte(probe).sort((a, b) => a - b)).toEqual(expected);
  });
});
