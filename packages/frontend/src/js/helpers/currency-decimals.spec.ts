import {
  DEFAULT_CURRENCY_DECIMALS,
  getCurrencyDecimals,
  isIntlCurrencyCode,
  registerCurrencyDecimals,
  resetCurrencyDecimals,
  trimAmountNoise,
} from './currency-decimals';

describe('js/helpers/currency-decimals', () => {
  afterEach(() => {
    resetCurrencyDecimals();
  });

  describe('getCurrencyDecimals', () => {
    test.each<[string, number]>([
      ['USD', 2],
      ['JPY', 0],
      ['VND', 0],
      ['KWD', 3],
      ['BHD', 3],
    ])('falls back to the ISO decimals of %s: %d', (code, expected) => {
      expect(getCurrencyDecimals({ code })).toBe(expected);
    });

    test('an unknown code with nothing registered gets the default', () => {
      expect(getCurrencyDecimals({ code: 'USDT' })).toBe(DEFAULT_CURRENCY_DECIMALS);
    });

    test('a missing code gets the default', () => {
      expect(getCurrencyDecimals({ code: undefined })).toBe(DEFAULT_CURRENCY_DECIMALS);
      expect(getCurrencyDecimals({ code: null })).toBe(DEFAULT_CURRENCY_DECIMALS);
      expect(getCurrencyDecimals({ code: '' })).toBe(DEFAULT_CURRENCY_DECIMALS);
    });

    test('a registered value wins over the ISO one', () => {
      registerCurrencyDecimals({
        entries: [
          { code: 'BTC', decimals: 8 },
          { code: 'JPY', decimals: 1 },
        ],
      });

      expect(getCurrencyDecimals({ code: 'BTC' })).toBe(8);
      expect(getCurrencyDecimals({ code: 'JPY' })).toBe(1);
    });

    test('zero registered decimals are honoured, not treated as missing', () => {
      registerCurrencyDecimals({ entries: [{ code: 'SAT', decimals: 0 }] });

      expect(getCurrencyDecimals({ code: 'SAT' })).toBe(0);
    });

    test('registering twice keeps earlier codes and lets the later value win', () => {
      registerCurrencyDecimals({ entries: [{ code: 'BTC', decimals: 8 }] });
      registerCurrencyDecimals({
        entries: [
          { code: 'ETH', decimals: 18 },
          { code: 'BTC', decimals: 6 },
        ],
      });

      expect(getCurrencyDecimals({ code: 'BTC' })).toBe(6);
      expect(getCurrencyDecimals({ code: 'ETH' })).toBe(18);
    });

    test.each<[string, number | null | undefined]>([
      ['negative', -1],
      ['fractional', 2.5],
      ['null', null],
      ['undefined', undefined],
      ['not a number', Number.NaN],
    ])('skips an unusable value (%s) and keeps the fallback', (_label, decimals) => {
      registerCurrencyDecimals({ entries: [{ code: 'KWD', decimals }] });

      expect(getCurrencyDecimals({ code: 'KWD' })).toBe(3);
    });
  });

  describe('isIntlCurrencyCode', () => {
    test('is true for ISO codes and false for tickers Intl rejects', () => {
      expect(isIntlCurrencyCode({ code: 'USD' })).toBe(true);
      expect(isIntlCurrencyCode({ code: 'USDT' })).toBe(false);
      expect(isIntlCurrencyCode({ code: 'BTC1' })).toBe(false);
    });
  });

  describe('trimAmountNoise', () => {
    test.each<[number, number, number]>([
      [0.1 + 0.2, 2, 0.3],
      [0.1 + 0.2, 3, 0.3],
      [1.234 + 2.001, 3, 3.235],
      [10 - 9.9, 1, 0.1],
      [1500, 0, 1500],
      [20_500_000_000.25 + 0.5, 2, 20_500_000_000.75],
    ])('%d at %d decimals → %d', (value, decimals, expected) => {
      expect(trimAmountNoise({ value, decimals })).toBe(expected);
    });
  });
});
