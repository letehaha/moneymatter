import { describe, expect, it } from '@jest/globals';
import { ValidationError } from '@js/errors';

import {
  assertEditPairRules,
  assertRemovePairRules,
  editExchangeRatePairSchema,
  removeExchangeRatePairSchema,
} from './exchange-rate-pair-rules';

const USD_EUR = { baseCode: 'USD', quoteCode: 'EUR' };
const EUR_USD = { baseCode: 'EUR', quoteCode: 'USD' };

describe('assertEditPairRules', () => {
  it('accepts pairs that come with their opposite', () => {
    expect(() => assertEditPairRules({ pairs: [USD_EUR, EUR_USD] })).not.toThrow();
  });

  it('refuses a pair whose base and quote are the same code', () => {
    expect(() => assertEditPairRules({ pairs: [{ baseCode: 'USD', quoteCode: 'USD' }] })).toThrow(ValidationError);
    expect(() => assertEditPairRules({ pairs: [{ baseCode: 'USD', quoteCode: 'USD' }] })).toThrow(
      'You cannot edit pair with the same base and quote currency code.',
    );
  });

  it('refuses a one-sided pair', () => {
    expect(() => assertEditPairRules({ pairs: [USD_EUR] })).toThrow(ValidationError);
    expect(() => assertEditPairRules({ pairs: [USD_EUR] })).toThrow(
      "When changing base-quote pair rate, you need to also change opposite pair's rate.",
    );
  });
});

describe('assertRemovePairRules', () => {
  it('accepts pairs that come with their opposite', () => {
    expect(() => assertRemovePairRules({ pairs: [USD_EUR, EUR_USD] })).not.toThrow();
  });

  it('refuses a one-sided pair', () => {
    expect(() => assertRemovePairRules({ pairs: [USD_EUR] })).toThrow(ValidationError);
    expect(() => assertRemovePairRules({ pairs: [USD_EUR] })).toThrow(
      "When removing base-qoute pair rate, you need to also remove opposite pair's rate.",
    );
  });
});

describe('exchange rate pair schemas', () => {
  it('edit: accepts a dated pair and rejects a non-positive rate or an unknown key', () => {
    expect(editExchangeRatePairSchema.safeParse({ ...USD_EUR, rate: 0.9, effectiveDate: '2026-10-01' }).success).toBe(
      true,
    );
    expect(editExchangeRatePairSchema.safeParse({ ...USD_EUR, rate: 0 }).success).toBe(false);
    expect(editExchangeRatePairSchema.safeParse({ ...USD_EUR, rate: 1, extra: true }).success).toBe(false);
  });

  it('remove: takes a pair with no rate', () => {
    expect(removeExchangeRatePairSchema.safeParse(USD_EUR).success).toBe(true);
    expect(removeExchangeRatePairSchema.safeParse({ baseCode: 'USD' }).success).toBe(false);
  });
});
