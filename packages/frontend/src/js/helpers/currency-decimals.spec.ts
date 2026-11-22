import {
  DEFAULT_CURRENCY_DECIMALS,
  getCurrencyDecimals,
  getSmallestCurrencyUnit,
  isIntlCurrencyCode,
  registerCurrencyDecimals,
  registerFallbackCurrencyMeta,
  resetCurrencyDecimals,
  resolveCurrencyDisplay,
  roundToDecimals,
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

    // CLDR (behind `Intl`) gives IQD 0 digits where ISO 4217 says 3.
    test('an unregistered IQD takes the Intl decimals', () => {
      expect(getCurrencyDecimals({ code: 'IQD' })).toBe(0);
    });

    test.each<[string, number]>([
      ['HUF', 2],
      ['IQD', 3],
    ])('a registered %s takes the backend decimals over Intl: %d', (code, decimals) => {
      registerCurrencyDecimals({ entries: [{ code, decimals }] });

      expect(getCurrencyDecimals({ code })).toBe(decimals);
    });

    test('an unknown code with nothing registered gets the default', () => {
      expect(getCurrencyDecimals({ code: 'USDT' })).toBe(DEFAULT_CURRENCY_DECIMALS);
    });

    test('a missing code gets the default', () => {
      expect(getCurrencyDecimals({ code: undefined })).toBe(DEFAULT_CURRENCY_DECIMALS);
      expect(getCurrencyDecimals({ code: null })).toBe(DEFAULT_CURRENCY_DECIMALS);
      expect(getCurrencyDecimals({ code: '' })).toBe(DEFAULT_CURRENCY_DECIMALS);
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

    test('a replacing registration drops codes the new list no longer has', () => {
      registerCurrencyDecimals({ entries: [{ code: 'GOLD', decimals: 3, isCustom: true, symbol: 'g' }] });
      registerCurrencyDecimals({ entries: [{ code: 'USD', decimals: 2 }], replace: true });

      expect(resolveCurrencyDisplay({ code: 'GOLD' })).toEqual({
        decimals: DEFAULT_CURRENCY_DECIMALS,
        isCustom: true,
        symbol: null,
      });
    });

    test('once the catalogue is loaded, a code it lacks is custom even when Intl accepts it', () => {
      expect(resolveCurrencyDisplay({ code: 'SAT' }).isCustom).toBe(false);

      registerCurrencyDecimals({ entries: [{ code: 'USD', decimals: 2 }], replace: true });

      expect(resolveCurrencyDisplay({ code: 'SAT' }).isCustom).toBe(true);
      expect(resolveCurrencyDisplay({ code: 'USD' }).isCustom).toBe(false);
    });

    test('the owner definitions are replaced, not merged', () => {
      registerFallbackCurrencyMeta({ entries: [{ code: 'BTC', meta: { decimals: 8, symbol: null, isCustom: true } }] });
      registerFallbackCurrencyMeta({ entries: [{ code: 'SAT', meta: { decimals: 0, symbol: null, isCustom: true } }] });

      expect(getCurrencyDecimals({ code: 'BTC' })).toBe(DEFAULT_CURRENCY_DECIMALS);
      expect(getCurrencyDecimals({ code: 'SAT' })).toBe(0);
    });

    test('reset clears the owner definitions too', () => {
      registerFallbackCurrencyMeta({ entries: [{ code: 'BTC', meta: { decimals: 8, symbol: null, isCustom: true } }] });
      resetCurrencyDecimals();

      expect(getCurrencyDecimals({ code: 'BTC' })).toBe(DEFAULT_CURRENCY_DECIMALS);
    });
  });

  describe('getSmallestCurrencyUnit', () => {
    test.each<[string | undefined, number]>([
      ['USD', 0.01],
      ['JPY', 1],
      ['KWD', 0.001],
      [undefined, 0.01],
    ])('%s → %d', (code, expected) => {
      expect(getSmallestCurrencyUnit({ code })).toBe(expected);
    });

    test('follows a registered precision', () => {
      registerCurrencyDecimals({ entries: [{ code: 'BTC', decimals: 8 }] });

      expect(getSmallestCurrencyUnit({ code: 'BTC' })).toBe(1e-8);
    });

    test('follows an explicit meta', () => {
      expect(getSmallestCurrencyUnit({ code: 'SAT', meta: { decimals: 0, symbol: null, isCustom: true } })).toBe(1);
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

  describe('roundToDecimals', () => {
    test.each<[number, number, number]>([
      [1.005 * 1000, 0, 1005],
      [28567.43, 0, 28567],
      [28567.5, 0, 28568],
      [1.2345, 3, 1.235],
      [1.2344, 3, 1.234],
      [85607.126, 2, 85607.13],
      [10.1255, 3, 10.126],
      [1.005, 2, 1.01],
      [1.255, 2, 1.26],
      [2.675, 2, 2.68],
      [1.0005, 3, 1.001],
      [0.5, 0, 1],
      [-0.5, 0, -1],
      [-1.5, 0, -2],
      [-2.5, 0, -3],
      [-1.005, 2, -1.01],
      [-0.001, 2, 0],
      [5e-8, 8, 5e-8],
      [1.5e-7, 7, 2e-7],
    ])('%d at %d decimals → %d', (value, decimals, expected) => {
      expect(roundToDecimals({ value, decimals })).toBe(expected);
    });
  });
});
