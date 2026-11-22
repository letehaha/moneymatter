import { describe, expect, it } from 'vitest';

import { formatCustomRate, rateDisplayOptions, roundRate } from './rate-precision';

describe('roundRate', () => {
  it('rounds an ISO rate to the given decimals', () => {
    expect(roundRate({ value: 1.23456789, isCustom: false, isoDecimals: 4 })).toBe(1.2346);
  });

  it('keeps 12 significant digits on a custom rate, however small', () => {
    expect(roundRate({ value: 1 / 3, isCustom: true, isoDecimals: 4 })).toBe(0.333333333333);
    expect(roundRate({ value: 1.234567891234567e-13, isCustom: true, isoDecimals: 4 })).toBe(1.23456789123e-13);
  });

  it('passes a missing rate through as NaN', () => {
    expect(roundRate({ value: Number(undefined), isCustom: true, isoDecimals: 4 })).toBeNaN();
    expect(roundRate({ value: Number(undefined), isCustom: false, isoDecimals: 4 })).toBeNaN();
  });
});

describe('rateDisplayOptions', () => {
  it('shows a custom rate by significant digits and an ISO rate by decimals', () => {
    expect(rateDisplayOptions({ isCustom: true, isoDecimals: 6 })).toEqual({
      minimumFractionDigits: 0,
      maximumSignificantDigits: 12,
    });
    expect(rateDisplayOptions({ isCustom: false, isoDecimals: 6 })).toEqual({
      minimumFractionDigits: 0,
      maximumFractionDigits: 6,
    });
  });
});

describe('formatCustomRate', () => {
  it('keeps the significant digits of a tiny rate and drops trailing zeros', () => {
    expect(formatCustomRate({ value: 0.000000123456789 })).toBe('0.000000123456789');
    expect(formatCustomRate({ value: 2 })).toBe('2');
  });
});
