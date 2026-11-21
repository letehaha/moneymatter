import { describe, expect, it } from '@jest/globals';
import { UnexpectedError } from '@js/errors';

import { applyCurrencyOverrides, withEffectiveCurrency } from './effective-currency';

const SAT = { code: 'SAT', currency: 'SAT', digits: 8, isCustom: true };
const USD = { code: 'USD', currency: 'US Dollar', digits: 2, isCustom: false };
const NO_OVERRIDES = { nameOverride: null, symbolOverride: null, decimalsOverride: null };

describe('applyCurrencyOverrides', () => {
  it("takes name, symbol and decimals of a custom currency from the user's definition", () => {
    expect(
      applyCurrencyOverrides({
        currency: SAT,
        overrides: { nameOverride: 'Sats', symbolOverride: 'sat', decimalsOverride: 0 },
      }),
    ).toEqual({ code: 'SAT', name: 'Sats', decimals: 0, symbol: 'sat', isCustom: true });
  });

  it('keeps an empty symbol as "no symbol"', () => {
    expect(
      applyCurrencyOverrides({
        currency: SAT,
        overrides: { ...NO_OVERRIDES, nameOverride: 'Sats', decimalsOverride: 2 },
      }),
    ).toEqual({ code: 'SAT', name: 'Sats', decimals: 2, symbol: null, isCustom: true });
  });

  it('throws for a custom currency without a definition', () => {
    expect(() => applyCurrencyOverrides({ currency: SAT, overrides: NO_OVERRIDES })).toThrow(UnexpectedError);
    expect(() => applyCurrencyOverrides({ currency: SAT, overrides: null })).toThrow(UnexpectedError);
  });

  it('ignores overrides on an ISO currency', () => {
    expect(
      applyCurrencyOverrides({
        currency: USD,
        overrides: { nameOverride: 'Dollars', symbolOverride: '$', decimalsOverride: 5 },
      }),
    ).toEqual({ code: 'USD', name: 'US Dollar', decimals: 2, symbol: null, isCustom: false });
  });
});

describe('withEffectiveCurrency', () => {
  it('rewrites the joined currency of a custom holding', () => {
    const item = { currencyCode: 'SAT', ...NO_OVERRIDES, decimalsOverride: 4, nameOverride: 'Sats', currency: SAT };

    const result = withEffectiveCurrency({ item });

    expect(result.currency).toMatchObject({ code: 'SAT', currency: 'Sats', digits: 4, symbol: null, isCustom: true });
    expect(result.currencyCode).toBe('SAT');
    // The source row is not mutated.
    expect(item.currency.digits).toBe(8);
  });

  it('gives an ISO holding a null symbol', () => {
    const item = { ...NO_OVERRIDES, currency: USD };

    expect(withEffectiveCurrency({ item }).currency).toEqual({ ...USD, symbol: null });
  });
});
