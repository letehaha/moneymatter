import { describe, expect, it } from '@jest/globals';

import { applyCurrencyOverrides, withEffectiveCurrency } from './effective-currency';

const SAT = { code: 'SAT', currency: 'Satoshi (global)', digits: 4, symbol: 'S', isCustom: true };
const USD = { code: 'USD', currency: 'US Dollar', digits: 2, symbol: null, isCustom: false };
const NO_OVERRIDES = { nameOverride: null, symbolOverride: null, decimalsOverride: null };

describe('applyCurrencyOverrides', () => {
  it("replaces name, symbol and decimals of a custom currency with the user's own", () => {
    expect(
      applyCurrencyOverrides({
        currency: SAT,
        overrides: { nameOverride: 'Sats', symbolOverride: 'sat', decimalsOverride: 8 },
      }),
    ).toEqual({ code: 'SAT', name: 'Sats', decimals: 8, symbol: 'sat', isCustom: true });
  });

  it('keeps the global name and symbol of a row that has no definition of its own', () => {
    expect(applyCurrencyOverrides({ currency: SAT, overrides: NO_OVERRIDES })).toEqual({
      code: 'SAT',
      name: 'Satoshi (global)',
      decimals: 4,
      symbol: 'S',
      isCustom: true,
    });
  });

  it('reads an empty symbol on a defined row as "no symbol", not as the creator symbol', () => {
    expect(applyCurrencyOverrides({ currency: SAT, overrides: { ...NO_OVERRIDES, decimalsOverride: 0 } })).toEqual({
      code: 'SAT',
      name: 'Satoshi (global)',
      decimals: 0,
      symbol: null,
      isCustom: true,
    });
  });

  it('serves the global row when the user holds no row at all', () => {
    expect(applyCurrencyOverrides({ currency: SAT, overrides: null })).toEqual({
      code: 'SAT',
      name: 'Satoshi (global)',
      decimals: 4,
      symbol: 'S',
      isCustom: true,
    });
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
    const item = { currencyCode: 'SAT', ...NO_OVERRIDES, decimalsOverride: 8, nameOverride: 'Sats', currency: SAT };

    const result = withEffectiveCurrency({ item });

    expect(result.currency).toMatchObject({ code: 'SAT', currency: 'Sats', digits: 8, symbol: null, isCustom: true });
    expect(result.currencyCode).toBe('SAT');
    // The source row is not mutated.
    expect(item.currency.digits).toBe(4);
  });

  it('returns an ISO holding as it is', () => {
    const item = { ...NO_OVERRIDES, currency: USD };

    expect(withEffectiveCurrency({ item })).toBe(item);
  });
});
