import { formatShare, formatSignedPercent } from './percentage';

describe('formatShare', () => {
  it('renders a fraction as an unsigned one-decimal percent', () => {
    expect(formatShare({ fraction: 0.12345 })).toBe('12.3%');
    expect(formatShare({ fraction: 0 })).toBe('0.0%');
    expect(formatShare({ fraction: -0.05 })).toBe('-5.0%');
  });

  it('renders a dash for missing or non-finite values', () => {
    expect(formatShare({ fraction: null })).toBe('—');
    expect(formatShare({ fraction: Number.NaN })).toBe('—');
  });
});

describe('formatSignedPercent', () => {
  it('prefixes non-negative values with a plus sign', () => {
    expect(formatSignedPercent({ fraction: 0.05 })).toBe('+5.00%');
    expect(formatSignedPercent({ fraction: 0 })).toBe('+0.00%');
    expect(formatSignedPercent({ fraction: -0.1234 })).toBe('-12.34%');
  });

  it('renders a dash for missing or non-finite values', () => {
    expect(formatSignedPercent({ fraction: null })).toBe('—');
    expect(formatSignedPercent({ fraction: Number.NaN })).toBe('—');
    expect(formatSignedPercent({ fraction: Infinity })).toBe('—');
  });
});
