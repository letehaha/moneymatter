import { formatCompactTick } from './format-compact-tick';

describe('formatCompactTick', () => {
  it('adds decimals when ticks are closer than the unit', () => {
    expect(formatCompactTick({ value: 177_500, step: 500, symbol: '$' })).toBe('$177.5K');
    expect(formatCompactTick({ value: 177_000, step: 1000, symbol: '$' })).toBe('$177K');
    expect(formatCompactTick({ value: 1_250_000, step: 250_000, symbol: '$' })).toBe('$1.25M');
    expect(formatCompactTick({ value: 250, step: 50, symbol: '€' })).toBe('€250');
  });

  it('keeps sub-unit ticks distinct and caps at two decimals', () => {
    expect(formatCompactTick({ value: 0.5, step: 0.25, symbol: '$' })).toBe('$0.50');
    expect(formatCompactTick({ value: 1 / 3, step: 1 / 3, symbol: '$' })).toBe('$0.33');
  });

  it('grows decimals for sub-cent steps', () => {
    expect(formatCompactTick({ value: 0.004, step: 0.001, symbol: '$' })).toBe('$0.004');
    expect(formatCompactTick({ value: 0.00012, step: 0.00002, symbol: '$' })).toBe('$0.00012');
  });

  it('caps sub-cent decimals at eight', () => {
    expect(formatCompactTick({ value: 0.000000003, step: 0.000000001, symbol: '$' })).toBe('$0.00000000');
  });

  it('renders zero and a zero step without decimals', () => {
    expect(formatCompactTick({ value: 0, step: 0, symbol: '$' })).toBe('$0');
  });

  it('formats negatives with the same unit as their magnitude', () => {
    expect(formatCompactTick({ value: -2_500, step: 500, symbol: '$' })).toBe('-$2.5K');
    expect(formatCompactTick({ value: -40, step: 20, symbol: '$' })).toBe('-$40');
  });

  it('ignores float noise in the step', () => {
    expect(formatCompactTick({ value: 0.3, step: 0.1 + 0.2, symbol: '$' })).toBe('$0.3');
  });
});
