import { calculateRatio } from './calculate-ratio';

describe('calculateRatio', () => {
  it('rounds the inverse of an ISO rate to 6 decimals', () => {
    expect(calculateRatio({ value: 3, isCustom: false })).toBe(0.333333);
  });

  it('keeps 12 significant digits for a custom currency, so a tiny inverse is not rounded away', () => {
    expect(calculateRatio({ value: 50000, isCustom: true })).toBe(0.00002);
    expect(calculateRatio({ value: 3e9, isCustom: true })).toBe(3.33333333333e-10);
    expect(calculateRatio({ value: 3e9, isCustom: false })).toBe(0);
  });

  it('returns 0 for a value without an inverse', () => {
    expect(calculateRatio({ value: 0, isCustom: true })).toBe(0);
    expect(calculateRatio({ value: '', isCustom: false })).toBe(0);
    expect(calculateRatio({ value: 'abc', isCustom: true })).toBe(0);
  });
});
