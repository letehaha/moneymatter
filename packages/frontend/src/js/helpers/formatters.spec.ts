import { registerCurrencyDecimals, resetCurrencyDecimals } from './currency-decimals';
import {
  currencyDisplayPreference,
  formatCompactFiat,
  formatCompactUIAmount,
  formatTinyUIAmount,
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

    test.each<[string, number, string]>([
      ['BHD', 1234.567, '1,234.567'],
      ['KWD', 1234.5, '1,234.500'],
      ['KWD', 0.001, '0.001'],
    ])('three-decimal currency %s keeps all three decimals: %d', (currency, value, expected) => {
      expect(formatUIAmount(value, { currency })).toContain(expected);
    });

    test('large VND values (0 decimals) group without a fraction', () => {
      const out = formatUIAmount(20_500_000_000, { currency: 'VND' });
      expect(out).toContain('20,500,000,000');
      expect(out).not.toContain('.');
    });

    test('malformed currency code degrades to a bare number + code instead of throwing', () => {
      expect(formatUIAmount(1234.5, { currency: 'USDT' })).toBe('1,234.50 USDT');
    });

    describe('registered decimals', () => {
      afterEach(() => {
        resetCurrencyDecimals();
      });

      test('a ticker renders with its registered decimals', () => {
        registerCurrencyDecimals({ entries: [{ code: 'BTC', decimals: 8 }] });
        expect(formatUIAmount(0.00040641, { currency: 'BTC' })).toContain('0.00040641');
        expect(formatUIAmount(2, { currency: 'BTC' })).toContain('2.00000000');
      });

      test('a code Intl rejects renders its registered decimals with the code appended', () => {
        registerCurrencyDecimals({ entries: [{ code: 'USDT', decimals: 6 }] });
        expect(formatUIAmount(0.5, { currency: 'USDT' })).toBe('0.50 USDT');
      });

      test('a registered value wins over the ISO one', () => {
        registerCurrencyDecimals({ entries: [{ code: 'USD', decimals: 4 }] });
        expect(formatUIAmount(1.23456, { currency: 'USD' })).toBe('$1.2346');
      });

      test('toLocalCurrencyNumber follows the registered decimals', () => {
        registerCurrencyDecimals({ entries: [{ code: 'USDT', decimals: 6 }] });
        expect(toLocalCurrencyNumber(1.5, { currency: 'USDT' })).toBe('1.50');
      });
    });

    describe('custom currencies', () => {
      afterEach(() => {
        resetCurrencyDecimals();
      });

      test('a code Intl rejects renders as a plain number plus the code', () => {
        registerCurrencyDecimals({ entries: [{ code: 'USDT', decimals: 6, isCustom: true }] });
        expect(formatUIAmount(12.345678, { currency: 'USDT' })).toBe('12.35 USDT');
      });

      test('a three-letter code Intl would accept still renders as custom, never in currency style', () => {
        registerCurrencyDecimals({ entries: [{ code: 'SAT', decimals: 0, isCustom: true }] });
        const out = formatUIAmount(1234.6, { currency: 'SAT' });

        expect(out).toBe('1,235 SAT');
        expect(out).not.toContain('\u00a0');
      });

      test('the symbol replaces the code when the currency has one', () => {
        registerCurrencyDecimals({ entries: [{ code: 'USDT', decimals: 6, isCustom: true, symbol: '₮' }] });
        expect(formatUIAmount(-0.5, { currency: 'USDT' })).toBe('-0.50 ₮');
      });

      test('an explicit meta decides the decimals and the kind of a code the viewer does not define', () => {
        expect(
          formatUIAmount(0.12345678, { currency: 'SAT', meta: { decimals: 8, symbol: null, isCustom: true } }),
        ).toBe('0.1235 SAT');
      });

      test("a collaborator whose SAT has 0 decimals sees the owner's 8 on the owner's account", () => {
        registerCurrencyDecimals({ entries: [{ code: 'SAT', decimals: 0, isCustom: true }] });
        const ownerMeta = { decimals: 8, symbol: null, isCustom: true };

        expect(formatUIAmount(1.5, { currency: 'SAT', meta: ownerMeta })).toBe('1.50 SAT');
        expect(formatUIAmount(1.5, { currency: 'SAT' })).toBe('2 SAT');
      });

      test('toLocalCurrencyNumber follows an explicit meta', () => {
        registerCurrencyDecimals({ entries: [{ code: 'SAT', decimals: 0, isCustom: true }] });
        expect(
          toLocalCurrencyNumber(1.5, { currency: 'SAT', meta: { decimals: 3, symbol: null, isCustom: true } }),
        ).toBe('1.50');
      });

      test('an ISO currency keeps currency style with its registered decimals', () => {
        registerCurrencyDecimals({ entries: [{ code: 'KWD', decimals: 3, isCustom: false }] });
        expect(formatUIAmount(1.5, { currency: 'KWD' })).toBe(
          new Intl.NumberFormat('en-US', { style: 'currency', currency: 'KWD', minimumFractionDigits: 3 }).format(1.5),
        );
      });

      test('a three-letter code missing from the loaded catalogue renders as custom', () => {
        registerCurrencyDecimals({ entries: [{ code: 'USD', decimals: 2 }], replace: true });
        expect(formatUIAmount(1.5, { currency: 'ABC' })).toBe('1.50 ABC');
      });

      test.each([
        [1, '1.00 BTC'],
        [1000, '1,000.00 BTC'],
        [1.23456789, '1.235 BTC'],
        [0.00012345, '0.0001235 BTC'],
        [1234.5678, '1,234.57 BTC'],
        [0.99996, '1.00 BTC'],
        [0.1 + 0.2, '0.30 BTC'],
        [0, '0.00 BTC'],
        [-0.00012345, '-0.0001235 BTC'],
      ])('%s shows 4 significant digits with 2 to 8 decimals: %s', (amount, expected) => {
        registerCurrencyDecimals({ entries: [{ code: 'BTC', decimals: 8, isCustom: true }] });
        expect(formatUIAmount(amount, { currency: 'BTC' })).toBe(expected);
      });

      test('fullPrecision keeps every digit the currency carries, trimming trailing zeros', () => {
        registerCurrencyDecimals({ entries: [{ code: 'BTC', decimals: 8, isCustom: true }] });
        expect(formatUIAmount(1.23456789, { currency: 'BTC', fullPrecision: true })).toBe('1.23456789 BTC');
        expect(formatUIAmount(1, { currency: 'BTC', fullPrecision: true })).toBe('1.00 BTC');
        expect(formatUIAmount(0.1 + 0.2, { currency: 'BTC', fullPrecision: true })).toBe('0.30 BTC');
        expect(toLocalCurrencyNumber(1.23456789, { currency: 'BTC', fullPrecision: true })).toBe('1.23456789');
        expect(toLocalCurrencyNumber(1.23456789, { currency: 'BTC' })).toBe('1.235');
      });

      test('never shows more decimals than the currency carries, nor pads past them', () => {
        registerCurrencyDecimals({ entries: [{ code: 'XSIX', decimals: 6, isCustom: true }] });
        expect(formatUIAmount(0.00012345, { currency: 'XSIX' })).toBe('0.000123 XSIX');

        registerCurrencyDecimals({ entries: [{ code: 'XONE', decimals: 1, isCustom: true }] });
        expect(formatUIAmount(1, { currency: 'XONE' })).toBe('1.0 XONE');
        expect(formatUIAmount(1.2345, { currency: 'XONE' })).toBe('1.2 XONE');
      });

      test('explicit fraction digits win over the shortened display', () => {
        registerCurrencyDecimals({ entries: [{ code: 'BTC', decimals: 8, isCustom: true }] });
        expect(formatUIAmount(1.23456789, { currency: 'BTC', fractionDigits: 0 })).toBe('1 BTC');
      });

      test('an ISO currency ignores fullPrecision', () => {
        expect(formatUIAmount(1.5, { currency: 'USD', fullPrecision: true })).toBe('$1.50');
      });

      test('a compact amount puts the scale suffix before the label', () => {
        registerCurrencyDecimals({ entries: [{ code: 'USDT', decimals: 6, isCustom: true }] });
        expect(formatCompactUIAmount({ amount: 42_600, currency: 'USDT' })).toBe('42.6k USDT');

        registerCurrencyDecimals({ entries: [{ code: 'USDT', decimals: 6, isCustom: true, symbol: '₮' }] });
        expect(formatCompactUIAmount({ amount: 42_600, currency: 'USDT' })).toBe('42.6k ₮');
      });
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

    test.each<[number, string, string]>([
      [1234.567, 'BHD', '1,234.567'],
      [1234.5, 'KWD', '1,234.500'],
      [20_500_000_000, 'VND', '20,500,000,000'],
    ])('%d in %s keeps the currency decimals → %s', (value, currency, expected) => {
      expect(toLocalCurrencyNumber(value, { currency })).toBe(expected);
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

  describe('formatCompactUIAmount', () => {
    it.each([
      [0, '$0.00'],
      [9_400, '$9,400.00'],
      [9_999.99, '$9,999.99'],
      [10_000, '$10k'],
      [60_000, '$60k'],
      [50_400, '$50.4k'],
      [50_550, '$50.55k'],
      [99_996, '$100k'],
      [385_400, '$385k'],
      [491_800, '$492k'],
      [999_600, '$1M'],
      [1_000_000, '$1M'],
      [1_240_000, '$1.24M'],
      [2_500_000, '$2.5M'],
      [999_996_000, '$1B'],
      [-42_600, '-$42.6k'],
      [-385_400, '-$385k'],
    ])('%d → %s', (amount, expected) => {
      expect(formatCompactUIAmount({ amount, currency: 'USD' })).toBe(expected);
    });

    it.each([
      [42_600, '$42,600.00'],
      [385_000, '$385k'],
    ])('with from: 100_000, %d → %s', (amount, expected) => {
      expect(formatCompactUIAmount({ amount, currency: 'USD', from: 100_000 })).toBe(expected);
    });
  });

  describe('formatTinyUIAmount', () => {
    it.each([
      [0, '$0'],
      [408.87, '$409'],
      [-812.18, '-$812'],
      [999.6, '$1K'],
      [1_100, '$1.1K'],
      [7_839.1, '$7.8K'],
      [269_450, '$269.5K'],
      [999_960, '$1M'],
      [1_240_000, '$1.2M'],
      [-2_602.67, '-$2.6K'],
      [-0.3, '$0'],
      [999_960_000, '$1B'],
      [1_240_000_000, '$1.2B'],
      [NaN, 'NaN'],
    ])('%d → %s', (amount, expected) => {
      expect(formatTinyUIAmount({ amount, currency: 'USD' })).toBe(expected);
    });
  });
});
