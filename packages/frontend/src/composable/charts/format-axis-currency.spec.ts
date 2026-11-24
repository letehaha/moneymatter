import { areAmountsHidden } from '@/js/helpers/formatters';
import { afterEach, describe, expect, it } from 'vitest';

import { formatAxisCurrency } from './format-axis-currency';

describe('formatAxisCurrency', () => {
  afterEach(() => {
    areAmountsHidden.value = false;
  });

  it.each([
    [500, '$500'],
    [2_000, '$2K'],
    [1_500_000, '$1.5M'],
    [-2_000, '$-2K'],
  ])('%d → %s', (value, expected) => {
    expect(formatAxisCurrency({ value, symbol: '$' })).toBe(expected);
  });

  it.each([500, 2_000, 1_500_000])('masks %d while amounts are hidden', (value) => {
    areAmountsHidden.value = true;
    expect(formatAxisCurrency({ value, symbol: '$' })).toBe('••••');
  });
});
