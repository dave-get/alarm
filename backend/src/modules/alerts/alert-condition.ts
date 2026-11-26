import { Decimal } from 'decimal.js';

export type Condition = 'ABOVE' | 'BELOW';

/**
 * Plan §6: ABOVE means >=, BELOW means <=. Decimal arithmetic only.
 * A jump over the exact target also triggers (1.45 -> 1.52 with target 1.50).
 */
export function shouldTrigger(currentPrice: string | Decimal, targetPrice: string | Decimal, condition: Condition): boolean {
  const current = new Decimal(currentPrice);
  const target = new Decimal(targetPrice);
  return condition === 'ABOVE' ? current.gte(target) : current.lte(target);
}

/**
 * RECURRING rearm level: the price must leave the condition by the margin.
 * ABOVE 1.50 with 0.5% margin rearms strictly below 1.4925; BELOW rearms strictly above target * 1.005.
 */
export function rearmThreshold(targetPrice: string | Decimal, condition: Condition, marginPercent: string | Decimal): Decimal {
  const target = new Decimal(targetPrice);
  const m = new Decimal(marginPercent).div(100);
  return condition === 'ABOVE' ? target.mul(new Decimal(1).minus(m)) : target.mul(new Decimal(1).plus(m));
}

export function shouldRearm(
  currentPrice: string | Decimal,
  targetPrice: string | Decimal,
  condition: Condition,
  marginPercent: string | Decimal,
): boolean {
  const current = new Decimal(currentPrice);
  const level = rearmThreshold(targetPrice, condition, marginPercent);
  return condition === 'ABOVE' ? current.lt(level) : current.gt(level);
}

/** Signed distance from current price to target, in percent of current (for the UI). */
export function distancePercent(currentPrice: string, targetPrice: string): string {
  const current = new Decimal(currentPrice);
  if (current.isZero()) return '0';
  return new Decimal(targetPrice).minus(current).div(current).mul(100).toDecimalPlaces(4).toString();
}
