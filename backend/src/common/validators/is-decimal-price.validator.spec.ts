import { isPositiveDecimalString } from './is-decimal-price.validator.js';
import { parseRoles } from '../../config/roles.js';

describe('isPositiveDecimalString', () => {
  it.each(['1.5000', '0.00000001', '105000', '999999999999.999999999999'])('accepts %s', (v) => {
    expect(isPositiveDecimalString(v)).toBe(true);
  });
  it.each(['0', '0.000', '-1', '1e5', '1.', '.5', ' 1.5', '1,5', '1234567890123', '1.1234567890123', 1.5, null])('rejects %s', (v) => {
    expect(isPositiveDecimalString(v)).toBe(false);
  });
});

describe('parseRoles', () => {
  it('defaults to all roles', () => {
    expect(parseRoles(undefined)).toEqual(['api', 'market', 'outbox', 'notifications']);
    expect(parseRoles('all')).toHaveLength(4);
  });
  it('parses a list and rejects unknown roles', () => {
    expect(parseRoles('api, market')).toEqual(['api', 'market']);
    expect(() => parseRoles('api,web')).toThrow(/web/);
  });
});
