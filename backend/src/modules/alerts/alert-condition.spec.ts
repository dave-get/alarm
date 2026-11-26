import { distancePercent, rearmThreshold, shouldRearm, shouldTrigger } from './alert-condition.js';

describe('shouldTrigger (plan §6)', () => {
  it('XRP target 1.50 ABOVE: 1.45 waits, 1.50 and 1.51 trigger', () => {
    expect(shouldTrigger('1.45', '1.50', 'ABOVE')).toBe(false);
    expect(shouldTrigger('1.50', '1.50', 'ABOVE')).toBe(true);
    expect(shouldTrigger('1.51', '1.50', 'ABOVE')).toBe(true);
  });

  it('a jump over the exact target triggers', () => {
    expect(shouldTrigger('1.62000000', '1.5000', 'ABOVE')).toBe(true);
    expect(shouldTrigger('1.20000000', '1.5000', 'BELOW')).toBe(true);
  });

  it('BELOW means less than or equal', () => {
    expect(shouldTrigger('1.5', '1.50', 'BELOW')).toBe(true);
    expect(shouldTrigger('1.500000000001', '1.5', 'BELOW')).toBe(false);
  });

  it('uses decimal arithmetic, not floats', () => {
    // 0.1 + 0.2 !== 0.3 in floating point; equal decimals must trigger exactly.
    expect(shouldTrigger('0.30000000', '0.3', 'ABOVE')).toBe(true);
    expect(shouldTrigger('0.299999999999', '0.3', 'ABOVE')).toBe(false);
    expect(shouldTrigger('104999.99000000', '105000', 'ABOVE')).toBe(false);
    expect(shouldTrigger('105000.00000000', '105000', 'ABOVE')).toBe(true);
  });
});

describe('recurring rearm', () => {
  it('ABOVE rearms strictly below target * (1 - margin)', () => {
    expect(rearmThreshold('1.50', 'ABOVE', '0.5').toString()).toBe('1.4925');
    expect(shouldRearm('1.4925', '1.50', 'ABOVE', '0.5')).toBe(false);
    expect(shouldRearm('1.4924', '1.50', 'ABOVE', '0.5')).toBe(true);
  });

  it('BELOW rearms strictly above target * (1 + margin)', () => {
    expect(rearmThreshold('100', 'BELOW', '1').toString()).toBe('101');
    expect(shouldRearm('101', '100', 'BELOW', '1')).toBe(false);
    expect(shouldRearm('101.01', '100', 'BELOW', '1')).toBe(true);
  });
});

describe('distancePercent', () => {
  it('is signed relative to the current price', () => {
    expect(distancePercent('1.45', '1.50')).toBe('3.4483');
    expect(distancePercent('2', '1')).toBe('-50');
  });
});
