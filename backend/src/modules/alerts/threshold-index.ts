import { Decimal } from 'decimal.js';

interface Entry<T> {
  id: string;
  key: Decimal;
  item: T;
}

/**
 * Sorted threshold index (plan §8: "sorted threshold indexes"). Entries are kept
 * ascending by key; range queries are a binary search plus a slice, so evaluating
 * a trade costs O(log n + matches) instead of scanning every alarm.
 */
export class ThresholdIndex<T> {
  private entries: Entry<T>[] = [];
  private readonly byId = new Map<string, Entry<T>>();

  get size() {
    return this.entries.length;
  }

  has(id: string) {
    return this.byId.has(id);
  }

  add(id: string, key: Decimal | string, item: T) {
    this.remove(id);
    const entry: Entry<T> = { id, key: new Decimal(key), item };
    const i = this.lowerBound(entry.key, false);
    this.entries.splice(i, 0, entry);
    this.byId.set(id, entry);
  }

  remove(id: string): T | undefined {
    const entry = this.byId.get(id);
    if (!entry) return undefined;
    this.byId.delete(id);
    const i = this.entries.indexOf(entry);
    if (i >= 0) this.entries.splice(i, 1);
    return entry.item;
  }

  /** Items with key <= value. */
  lte(value: Decimal) {
    return this.entries.slice(0, this.lowerBound(value, true)).map((e) => e.item);
  }

  /** Items with key < value. */
  lt(value: Decimal) {
    return this.entries.slice(0, this.lowerBound(value, false)).map((e) => e.item);
  }

  /** Items with key >= value. */
  gte(value: Decimal) {
    return this.entries.slice(this.lowerBound(value, false)).map((e) => e.item);
  }

  /** Items with key > value. */
  gt(value: Decimal) {
    return this.entries.slice(this.lowerBound(value, true)).map((e) => e.item);
  }

  values() {
    return this.entries.map((e) => e.item);
  }

  clear() {
    this.entries = [];
    this.byId.clear();
  }

  /** First index whose key is > value (inclusive=true) or >= value (inclusive=false). */
  private lowerBound(value: Decimal, inclusive: boolean) {
    let lo = 0;
    let hi = this.entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const cmp = this.entries[mid].key.cmp(value);
      if (cmp < 0 || (inclusive && cmp === 0)) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}
