import {
  currencyDisplayPreference,
  formatCompactFiat,
  formatShortFiat,
  formatFiat,
  formatLargeNumber,
  formatUIAmount,
  toLocalCurrencyNumber,
} from './formatters';

describe('js/helpers/formatters', () => {
  describe('formatUIAmount', () => {
    test.each([
      [10_000, '$10,000.00'],
      [1, '$1.00'],
      [-1, '-$1.00'],
      [-10_000, '-$10,000.00'],
      [0.0125, '$0.01'],
      [-0, '$0.00'],
      [NaN, 'NaN'],
      [Infinity, 'Infinity'],
      [-Infinity, '-Infinity'],
    ])('%s to be %s', (value, expected) => {
      expect(formatUIAmount(value)).toBe(expected);
    });
  });

  describe('formatUIAmount per-currency decimals', () => {
    test.each<[string, number, string]>([
      ['KRW', 1234.5, '1,235'],
      ['KRW', 1_000_000, '1,000,000'],
      ['JPY', 1234.5, '1,235'],
    ])('zero-decimal currency %s drops the fraction: %d', (currency, value, grouped) => {
      const out = formatUIAmount(value, { currency });
      expect(out).toContain(grouped);
      expect(out).not.toContain('.');
    });

    test('negative value in a zero-decimal currency keeps the sign, no fraction', () => {
      const out = formatUIAmount(-1234.5, { currency: 'KRW' });
      expect(out).toContain('-');
      expect(out).toContain('1,235');
      expect(out).not.toContain('.');
    });

    test('zero in a zero-decimal currency renders without fraction', () => {
      const out = formatUIAmount(0, { currency: 'KRW' });
      expect(out).toContain('0');
      expect(out).not.toContain('.');
    });

    test.each<[number, string]>([
      [1234.5, '$1,234.50'],
      [1, '$1.00'],
      [10_000, '$10,000.00'],
    ])('two-decimal currency (USD) is unchanged: %d → %s', (value, expected) => {
      expect(formatUIAmount(value, { currency: 'USD' })).toBe(expected);
    });

    test('three-decimal currency (BHD) is clamped to 2 (cents storage)', () => {
      const out = formatUIAmount(1234.567, { currency: 'BHD' });
      expect(out).toContain('1,234.57');
      expect(out).not.toMatch(/\.\d{3}/);
    });

    test('malformed currency code degrades to a bare number + code instead of throwing', () => {
      expect(formatUIAmount(1234.5, { currency: 'USDT' })).toBe('1,234.50 USDT');
    });

    test('fractionDigits overrides the currency decimals', () => {
      expect(formatUIAmount(72_187.5, { currency: 'USD', fractionDigits: 0 })).toBe('$72,188');
      expect(formatUIAmount(1234.5, { currency: 'USDT', fractionDigits: 0 })).toBe('1,235 USDT');
    });
  });

  describe('currencyDisplayPreference', () => {
    beforeEach(() => {
      currencyDisplayPreference.value = 'symbol';
    });

    test('symbol (default) keeps disambiguating codes', () => {
      expect(currencyDisplayPreference.value).toBe('symbol');
      expect(formatUIAmount(1234.5, { currency: 'PLN' })).toBe('PLN\u00a01,234.50');
      expect(formatUIAmount(1234.5, { currency: 'CAD' })).toBe('CA$1,234.50');
    });

    test('narrowSymbol renders the local short symbol', () => {
      currencyDisplayPreference.value = 'narrowSymbol';
      expect(formatUIAmount(1234.5, { currency: 'PLN' })).toBe('zł\u00a01,234.50');
      expect(formatUIAmount(1234.5, { currency: 'CAD' })).toBe('$1,234.50');
    });

    test('applies to compact fiat formatting too', () => {
      expect(formatLargeNumber(1630, { isFiat: true, currency: 'CAD' })).toBe('CA$1.63k');
      currencyDisplayPreference.value = 'narrowSymbol';
      expect(formatLargeNumber(1630, { isFiat: true, currency: 'CAD' })).toBe('$1.63k');
    });
  });

  describe('toLocalCurrencyNumber (bare number, no symbol)', () => {
    test.each<[number, string, string]>([
      [1500, 'KRW', '1,500'],
      [7_188_072.8, 'KRW', '7,188,073'],
      [1500, 'JPY', '1,500'],
      [1500, 'USD', '1,500.00'],
      [1500.5, 'USD', '1,500.50'],
    ])('%d in %s → %s', (value, currency, expected) => {
      expect(toLocalCurrencyNumber(value, { currency })).toBe(expected);
    });

    test('renders no currency symbol', () => {
      const out = toLocalCurrencyNumber(1500, { currency: 'KRW' });
      expect(out).not.toContain('₩');
      expect(out).not.toContain('.');
    });

    test('defaults to 2 digits when currency is omitted', () => {
      expect(toLocalCurrencyNumber(1500)).toBe('1,500.00');
    });

    test('three-decimal currency (BHD) is clamped to 2 (cents storage)', () => {
      expect(toLocalCurrencyNumber(1234.567, { currency: 'BHD' })).toBe('1,234.57');
    });

    test('malformed currency code falls back to 2 digits without throwing', () => {
      expect(toLocalCurrencyNumber(1234.5, { currency: 'USDT' })).toBe('1,234.50');
    });

    test('explicit fraction digits override the currency-derived default', () => {
      expect(
        toLocalCurrencyNumber(1234.5, { currency: 'KRW', minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      ).toBe('1,234.50');
    });
  });

  describe('formatFiat', () => {
    test.each([
      [10_000, '10000.00'],
      [1, '1.00'],
      [-1, '-1.00'],
      [-10_000, '-10000.00'],
      [0.0125, '0.01'],
      [NaN, 'NaN'],
      [Infinity, 'Infinity'],
      [-Infinity, '-Infinity'],
    ])('%s to be %s', (value, expected) => {
      expect(formatFiat(value)).toBe(expected);
    });
  });

  describe('formatCompactFiat', () => {
    it.each([
      [950, '$950'],
      [75_000, '$75K'],
      [52_500, '$52.5K'],
      [254_930, '$255K'],
      [700_000, '$700K'],
      [999_600, '$1M'],
      [1_019_999, '$1.02M'],
      [1_500_000, '$1.5M'],
      [0, '$0'],
      [-52_500, '-$52.5K'],
    ])('%d → %s', (amount, expected) => {
      expect(formatCompactFiat({ amount, currency: 'USD' })).toBe(expected);
    });
  });

  describe('formatShortFiat', () => {
    it.each([
      [0, '$0.00'],
      [999.99, '$999.99'],
      [-999.5, '-$999.50'],
      [1_000, '$1K'],
      [1_840, '$1.84K'],
      [-1_592.2, '-$1.59K'],
      [2_440_000, '$2.44M'],
    ])('%d → %s', (amount, expected) => {
      expect(formatShortFiat({ amount, currency: 'USD' })).toBe(expected);
    });
  });
});
