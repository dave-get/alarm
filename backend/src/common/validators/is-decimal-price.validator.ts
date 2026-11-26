import { registerDecorator, type ValidationOptions } from 'class-validator';
import { Decimal } from 'decimal.js';

const DECIMAL_RE = /^\d{1,12}(\.\d{1,12})?$/;

/** Plan §13: strict positive decimal prices, sent as strings. Fits NUMERIC(24,12). */
export function isPositiveDecimalString(value: unknown): value is string {
  if (typeof value !== 'string' || !DECIMAL_RE.test(value)) return false;
  return new Decimal(value).gt(0);
}

export function IsPositiveDecimalString(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isPositiveDecimalString',
      target: object.constructor,
      propertyName,
      options: {
        message: `${propertyName} must be a positive decimal string with at most 12 integer and 12 fractional digits`,
        ...options,
      },
      validator: { validate: (value: unknown) => isPositiveDecimalString(value) },
    });
  };
}
