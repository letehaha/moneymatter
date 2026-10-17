import {
  DEFAULT_CURRENCY_DECIMALS,
  getCurrencyDecimals,
  isIntlCurrencyCode,
  registerCurrencyDecimals,
  registerFallbackCurrencyMeta,
  resetCurrencyDecimals,
  resolveCurrencyDisplay,
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

  describe('resolveCurrencyDisplay', () => {
    test('an ISO code is not custom and has no symbol', () => {
      expect(resolveCurrencyDisplay({ code: 'USD' })).toEqual({ decimals: 2, isCustom: false, symbol: null });
    });

    test('a code Intl rejects is treated as custom', () => {
      expect(resolveCurrencyDisplay({ code: 'USDT' })).toEqual({ decimals: 2, isCustom: true, symbol: null });
    });

    test('a registered custom currency carries its decimals, symbol and kind, even for a code Intl accepts', () => {
      registerCurrencyDecimals({ entries: [{ code: 'SAT', decimals: 8, isCustom: true, symbol: 'sat' }] });

      expect(resolveCurrencyDisplay({ code: 'SAT' })).toEqual({ decimals: 8, isCustom: true, symbol: 'sat' });
    });

    test('an explicit meta wins over the registered definition of the same code', () => {
      registerCurrencyDecimals({ entries: [{ code: 'SAT', decimals: 0, isCustom: true }] });

      expect(
        resolveCurrencyDisplay({ code: 'SAT', meta: { decimals: 8, symbol: null, isCustom: true } }).decimals,
      ).toBe(8);
      expect(getCurrencyDecimals({ code: 'SAT', meta: { decimals: 8, symbol: null, isCustom: true } })).toBe(8);
    });

    test('an unusable meta is ignored', () => {
      registerCurrencyDecimals({ entries: [{ code: 'SAT', decimals: 3, isCustom: true }] });

      expect(getCurrencyDecimals({ code: 'SAT', meta: { decimals: -1, symbol: null, isCustom: true } })).toBe(3);
    });

    test('the owner definitions seen on shared accounts fill only codes the user does not define', () => {
      registerCurrencyDecimals({ entries: [{ code: 'SAT', decimals: 0, isCustom: true }] });
      registerFallbackCurrencyMeta({
        entries: [
          { code: 'SAT', meta: { decimals: 8, symbol: null, isCustom: true } },
          { code: 'BTC', meta: { decimals: 8, symbol: '₿', isCustom: true } },
          { code: 'ETH', meta: undefined },
        ],
      });

      expect(resolveCurrencyDisplay({ code: 'SAT' }).decimals).toBe(0);
      expect(resolveCurrencyDisplay({ code: 'BTC' })).toEqual({ decimals: 8, isCustom: true, symbol: '₿' });
      expect(resolveCurrencyDisplay({ code: 'ETH' }).decimals).toBe(DEFAULT_CURRENCY_DECIMALS);
    });

    test('reset clears the owner definitions too', () => {
      registerFallbackCurrencyMeta({ entries: [{ code: 'BTC', meta: { decimals: 8, symbol: null, isCustom: true } }] });
      resetCurrencyDecimals();

      expect(getCurrencyDecimals({ code: 'BTC' })).toBe(DEFAULT_CURRENCY_DECIMALS);
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
