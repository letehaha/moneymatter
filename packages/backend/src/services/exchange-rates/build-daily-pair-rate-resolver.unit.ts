import { describe, expect, it } from '@jest/globals';

import { formatRate } from './build-daily-pair-rate-resolver';

describe('formatRate', () => {
  it.each([
    { label: 'IRR -> USD', rate: 1 / 1_913_782.45 },
    { label: 'VND -> USD', rate: 1 / 25_688.74 },
    { label: 'USD -> BTC', rate: 0.0000112345678901 },
    { label: 'USD -> IRR', rate: 1_913_782.4512345 },
  ])('keeps at least 10 significant digits for $label', ({ rate }) => {
    expect(formatRate(rate) / rate).toBeCloseTo(1, 10);
  });
});
