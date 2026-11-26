import { Decimal } from 'decimal.js';
import type { Condition } from './types';

/** Display formatting only. Trigger logic lives on the server (decimal, never float). */
export function formatPrice(value: string | null | undefined): string {
  if (!value) return '—';
  let d: Decimal;
  try {
    d = new Decimal(value);
  } catch {
    return value;
  }
  const abs = d.abs();
  const dp = abs.gte(1000) ? 2 : abs.gte(1) ? 4 : 6;
  const [int, frac] = d.toFixed(dp).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}

/** Signed % from current price to target (server sends it too; this is for live ticks). */
export function distancePercent(current: string | null | undefined, target: string): string | null {
  if (!current) return null;
  try {
    const c = new Decimal(current);
    if (c.isZero()) return null;
    return new Decimal(target).minus(c).div(c).mul(100).toDecimalPlaces(2).toString();
  } catch {
    return null;
  }
}

export function isConditionMet(current: string | null | undefined, target: string, condition: Condition): boolean {
  if (!current) return false;
  try {
    const c = new Decimal(current);
    const t = new Decimal(target);
    return condition === 'ABOVE' ? c.gte(t) : c.lte(t);
  } catch {
    return false;
  }
}

export function isValidPrice(value: string): boolean {
  if (!/^\d{1,12}(\.\d{1,12})?$/.test(value)) return false;
  return new Decimal(value).gt(0);
}

export function timeAgo(iso: string | number | null | undefined): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${Math.max(0, s)}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString();
}
