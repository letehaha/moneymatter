import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import UserExchangeRates from '@models/user-exchange-rates.model';
import * as helpers from '@tests/helpers';
import type { ErrorResponse } from '@tests/helpers/common';

const USDT = 'USDT';
const USDC = 'USDC';

const createCustom = (code: string) =>
  helpers.createCustomCurrency({ payload: { code, name: `${code} coin`, decimals: 6 }, raw: true });

const savedSource = async ({ code }: { code: string }) => {
  const entry = (await helpers.getUserCurrencies()).find((item) => item.currencyCode === code);

  return { rateSource: entry?.rateSource, rateSourceConfig: entry?.rateSourceConfig };
};

const errorOf = (response: { body: { response: unknown } }) => response.body.response as ErrorResponse;

describe('PUT /user/currencies/:code/rate-source', () => {
  describe('defaults', () => {
    it('starts an ISO currency on the market provider and a custom one on manual rates', async () => {
      await createCustom(USDT);

      expect(await savedSource({ code: global.BASE_CURRENCY_CODE })).toEqual({
        rateSource: 'provider',
        rateSourceConfig: null,
      });
      expect(await savedSource({ code: USDT })).toEqual({ rateSource: 'manual', rateSourceConfig: null });
    });
  });

  describe('valid configurations of a custom currency', () => {
    it('saves a peg and reads it back', async () => {
      await createCustom(USDT);

      const response = await helpers.setCurrencyRateSource({
        code: USDT,
        payload: { rateSource: 'peg', config: { pegCurrency: 'usd', factor: 1.02 } },
      });

      const expected = { rateSource: 'peg', rateSourceConfig: { pegCurrency: 'USD', factor: 1.02 } };
      expect(response.statusCode).toBe(200);
      expect(response.body.response).toEqual({ currencyCode: USDT, ...expected });
      expect(await savedSource({ code: USDT })).toEqual(expected);
    });

    it('pegs one custom currency to another of the same user', async () => {
      await createCustom(USDT);
      await createCustom(USDC);

      const response = await helpers.setCurrencyRateSource({
        code: USDC,
        payload: { rateSource: 'peg', config: { pegCurrency: USDT, factor: 1 } },
      });

      expect(response.statusCode).toBe(200);
      expect((await savedSource({ code: USDC })).rateSourceConfig).toEqual({ pegCurrency: USDT, factor: 1 });
    });

    it('saves a CoinGecko coin, quoted in USD unless the config says otherwise', async () => {
      await createCustom(USDT);

      const byDefault = await helpers.setCurrencyRateSource({
        code: USDT,
        payload: { rateSource: 'coingecko', config: { coinId: 'tether' } },
      });
      expect(byDefault.statusCode).toBe(200);
      expect(byDefault.body.response).toMatchObject({
        rateSource: 'coingecko',
        rateSourceConfig: { coinId: 'tether', quoteCurrency: 'USD' },
      });

      const euro = await helpers.setCurrencyRateSource({
        code: USDT,
        payload: { rateSource: 'coingecko', config: { coinId: 'usd-coin', quoteCurrency: 'eur' } },
      });
      expect(euro.statusCode).toBe(200);
      expect(await savedSource({ code: USDT })).toEqual({
        rateSource: 'coingecko',
        rateSourceConfig: { coinId: 'usd-coin', quoteCurrency: 'EUR' },
      });
    });

    it('saves an HTTP source with its placeholders and JSON path', async () => {
      await createCustom(USDT);
      const config = {
        urlTemplate: 'https://rates.example.test/{code}/{quote}?day={date}',
        jsonPath: 'data.rates[0].price',
        quoteCurrency: 'GBP',
      };

      const response = await helpers.setCurrencyRateSource({ code: USDT, payload: { rateSource: 'http', config } });

      expect(response.statusCode).toBe(200);
      expect(await savedSource({ code: USDT })).toEqual({
        rateSource: 'http',
        rateSourceConfig: { ...config, headerNames: [] },
      });
    });

    it('defaults the HTTP quote currency to USD and accepts a $-rooted path', async () => {
      await createCustom(USDT);

      const response = await helpers.setCurrencyRateSource({
        code: USDT,
        payload: {
          rateSource: 'http',
          config: { urlTemplate: 'https://rates.example.test/price', jsonPath: '$.bitcoin.usd' },
        },
      });

      expect(response.statusCode).toBe(200);
      expect((await savedSource({ code: USDT })).rateSourceConfig).toMatchObject({ quoteCurrency: 'USD' });
    });

    it('drops the old config when the source changes', async () => {
      await createCustom(USDT);
      await helpers.setCurrencyRateSource({
        code: USDT,
        payload: { rateSource: 'peg', config: { pegCurrency: 'USD', factor: 1 } },
      });

      const response = await helpers.setCurrencyRateSource({ code: USDT, payload: { rateSource: 'manual' } });

      expect(response.statusCode).toBe(200);
      expect(await savedSource({ code: USDT })).toEqual({ rateSource: 'manual', rateSourceConfig: null });
    });

    it('does not touch the rates the user already entered', async () => {
      await createCustom(USDT);
      await helpers.editCurrencyExchangeRate({
        pairs: [
          { baseCode: USDT, quoteCode: global.BASE_CURRENCY_CODE, rate: 3 },
          { baseCode: global.BASE_CURRENCY_CODE, quoteCode: USDT, rate: 1 / 3 },
        ],
        raw: true,
      });
      const { id: userId } = await helpers.getUserInfo({ raw: true });
      const before = await UserExchangeRates.findAll({ where: { userId }, raw: true });
      expect(before.length).toBeGreaterThan(0);

      await helpers.setCurrencyRateSource({
        code: USDT,
        payload: { rateSource: 'peg', config: { pegCurrency: 'USD', factor: 1 } },
      });

      expect(await UserExchangeRates.findAll({ where: { userId }, raw: true })).toEqual(before);
    });
  });

  describe('ISO currencies', () => {
    it('accepts the provider and manual rates', async () => {
      const code = global.BASE_CURRENCY_CODE;

      const manual = await helpers.setCurrencyRateSource({ code, payload: { rateSource: 'manual' } });
      expect(manual.statusCode).toBe(200);
      expect(await savedSource({ code })).toEqual({ rateSource: 'manual', rateSourceConfig: null });

      const provider = await helpers.setCurrencyRateSource({ code, payload: { rateSource: 'provider' } });
      expect(provider.statusCode).toBe(200);
      expect(await savedSource({ code })).toEqual({ rateSource: 'provider', rateSourceConfig: null });
    });

    it('keeps the live-rate flag that the rate lookup reads in step with the saved source', async () => {
      const code = 'USD';
      await helpers.addUserCurrencies({ currencyCodes: [code], raw: true });
      const liveRateUpdate = async () =>
        (await helpers.getUserCurrencies()).find((item) => item.currencyCode === code)?.liveRateUpdate;
      expect(await liveRateUpdate()).toBe(true);

      await helpers.setCurrencyRateSource({ code, payload: { rateSource: 'manual' } });
      expect(await liveRateUpdate()).toBe(false);

      await helpers.setCurrencyRateSource({ code, payload: { rateSource: 'provider' } });
      expect(await liveRateUpdate()).toBe(true);
    });

    it('moves the saved source along when the flag changes through the currency settings or a manual rate', async () => {
      const code = 'USD';
      await helpers.addUserCurrencies({ currencyCodes: [code], raw: true });

      const off = await helpers.updateUserCurrency({
        currency: { currencyCode: code, liveRateUpdate: false },
        raw: false,
      });
      expect(off.statusCode).toBe(200);
      expect((await savedSource({ code })).rateSource).toBe('manual');

      await helpers.updateUserCurrency({ currency: { currencyCode: code, liveRateUpdate: true }, raw: false });
      expect((await savedSource({ code })).rateSource).toBe('provider');

      const rate = await helpers.editCurrencyExchangeRate({
        pairs: [
          { baseCode: code, quoteCode: global.BASE_CURRENCY_CODE, rate: 4 },
          { baseCode: global.BASE_CURRENCY_CODE, quoteCode: code, rate: 0.25 },
        ],
        raw: false,
      });
      expect(rate.statusCode).toBe(200);
      expect((await savedSource({ code })).rateSource).toBe('manual');
    });

    it.each([
      ['peg', { rateSource: 'peg', config: { pegCurrency: 'USD', factor: 1 } }],
      ['coingecko', { rateSource: 'coingecko', config: { coinId: 'bitcoin' } }],
      ['http', { rateSource: 'http', config: { urlTemplate: 'https://example.com/{date}', jsonPath: 'price' } }],
    ])('rejects a %s source with 422 and leaves the saved source alone', async (_name, payload) => {
      const code = global.BASE_CURRENCY_CODE;

      const response = await helpers.setCurrencyRateSource({ code, payload });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await savedSource({ code })).toEqual({ rateSource: 'provider', rateSourceConfig: null });
    });
  });

  describe('invalid requests', () => {
    it('rejects the market provider for a custom currency, which has none', async () => {
      await createCustom(USDT);

      const response = await helpers.setCurrencyRateSource({ code: USDT, payload: { rateSource: 'provider' } });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await savedSource({ code: USDT })).toEqual({ rateSource: 'manual', rateSourceConfig: null });
    });

    it.each([
      ['an unknown source', { rateSource: 'oracle' }],
      ['no source', {}],
      ['a peg without its config', { rateSource: 'peg' }],
      ['a peg factor of zero', { rateSource: 'peg', config: { pegCurrency: 'USD', factor: 0 } }],
      ['a negative peg factor', { rateSource: 'peg', config: { pegCurrency: 'USD', factor: -1 } }],
      ['a peg factor that is not a number', { rateSource: 'peg', config: { pegCurrency: 'USD', factor: '1' } }],
      ['a peg without a currency', { rateSource: 'peg', config: { factor: 1 } }],
      ['a malformed peg currency code', { rateSource: 'peg', config: { pegCurrency: 'U$D', factor: 1 } }],
      ['a config on manual rates', { rateSource: 'manual', config: { factor: 1 } }],
      ['an unknown key in a config', { rateSource: 'peg', config: { pegCurrency: 'USD', factor: 1, extra: 1 } }],
      ['a CoinGecko config without a coin', { rateSource: 'coingecko', config: {} }],
      ['a CoinGecko coin id with spaces', { rateSource: 'coingecko', config: { coinId: 'usd coin' } }],
      ['an uppercase CoinGecko coin id', { rateSource: 'coingecko', config: { coinId: 'Bitcoin' } }],
      ['an HTTP config without a path', { rateSource: 'http', config: { urlTemplate: 'https://example.com/{date}' } }],
      [
        'an HTTP URL that is not http(s)',
        { rateSource: 'http', config: httpConfig({ urlTemplate: 'ftp://x/{date}' }) },
      ],
      ['an HTTP URL that is not a URL', { rateSource: 'http', config: httpConfig({ urlTemplate: 'rates/{date}' }) }],
      [
        'an HTTP URL with credentials',
        { rateSource: 'http', config: httpConfig({ urlTemplate: 'https://user:pass@example.com/{date}' }) },
      ],
      [
        'an unknown placeholder',
        { rateSource: 'http', config: httpConfig({ urlTemplate: 'https://example.com/{day}' }) },
      ],
      ['a stray brace', { rateSource: 'http', config: httpConfig({ urlTemplate: 'https://example.com/{date' }) }],
      ['a JSON path that is not a path', { rateSource: 'http', config: httpConfig({ jsonPath: 'a..b[x]' }) }],
      ['an empty JSON path', { rateSource: 'http', config: httpConfig({ jsonPath: '' }) }],
      ['request headers that are not an object', { rateSource: 'http', config: httpConfig({ headers: 'Bearer x' }) }],
    ])('rejects %s with 422', async (_name, payload) => {
      await createCustom(USDT);
      await helpers.setCurrencyRateSource({
        code: USDT,
        payload: { rateSource: 'peg', config: { pegCurrency: 'USD', factor: 2 } },
      });

      const response = await helpers.setCurrencyRateSource({ code: USDT, payload });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      // A rejected request changes nothing.
      expect(await savedSource({ code: USDT })).toEqual({
        rateSource: 'peg',
        rateSourceConfig: { pegCurrency: 'USD', factor: 2 },
      });
    });

    it('rejects a currency pegged to itself', async () => {
      await createCustom(USDT);

      const response = await helpers.setCurrencyRateSource({
        code: USDT,
        payload: { rateSource: 'peg', config: { pegCurrency: USDT, factor: 1 } },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('rejects a peg to a code the user cannot use', async () => {
      await createCustom(USDT);

      const unknown = await helpers.setCurrencyRateSource({
        code: USDT,
        payload: { rateSource: 'peg', config: { pegCurrency: 'NOPE', factor: 1 } },
      });
      expect(unknown.statusCode).toBe(ERROR_CODES.ValidationError);

      // Another user's custom code reads exactly like an unknown one.
      const other = await helpers.signUpSecondUser();
      await helpers.asUser({
        cookies: other.cookies,
        fn: async () => {
          await createCustom(USDC);
        },
      });
      const foreign = await helpers.setCurrencyRateSource({
        code: USDT,
        payload: { rateSource: 'peg', config: { pegCurrency: USDC, factor: 1 } },
      });
      expect(foreign.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorOf(foreign).message).toBe(errorOf(unknown).message.replace('NOPE', USDC));
    });

    it('rejects a quote currency that is custom or unknown', async () => {
      await createCustom(USDT);
      await createCustom(USDC);

      for (const quoteCurrency of [USDC, 'NOPE']) {
        const coingecko = await helpers.setCurrencyRateSource({
          code: USDT,
          payload: { rateSource: 'coingecko', config: { coinId: 'tether', quoteCurrency } },
        });
        expect(coingecko.statusCode).toBe(ERROR_CODES.ValidationError);

        const http = await helpers.setCurrencyRateSource({
          code: USDT,
          payload: { rateSource: 'http', config: httpConfig({ quoteCurrency }) },
        });
        expect(http.statusCode).toBe(ERROR_CODES.ValidationError);
      }
    });

    it('answers 404 for a currency the user does not hold, including another user custom one', async () => {
      const notHeld = await helpers.setCurrencyRateSource({ code: 'JPY', payload: { rateSource: 'manual' } });
      expect(notHeld.statusCode).toBe(ERROR_CODES.NotFoundError);

      await createCustom(USDT);
      const other = await helpers.signUpSecondUser();
      await helpers.asUser({
        cookies: other.cookies,
        fn: async () => {
          const foreign = await helpers.setCurrencyRateSource({ code: USDT, payload: { rateSource: 'manual' } });
          expect(foreign.statusCode).toBe(ERROR_CODES.NotFoundError);
        },
      });
    });

    it('saves a source for a user who has no base currency, and values nothing', async () => {
      const other = await helpers.signUpSecondUser();
      await helpers.asUser({
        cookies: other.cookies,
        fn: async () => {
          await createCustom(USDT);

          const peg = await helpers.setCurrencyRateSource({
            code: USDT,
            payload: { rateSource: 'peg', config: { pegCurrency: 'USD', factor: 1 } },
          });
          expect(peg.statusCode).toBe(200);
          expect((await savedSource({ code: USDT })).rateSource).toBe('peg');

          // A manual rate edit and removal for the same user reach the same recompute.
          await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
          await helpers.setCurrencyRateSource({ code: USDT, payload: { rateSource: 'manual' } });
          const pairs = [
            { baseCode: USDT, quoteCode: 'USD', rate: 2 },
            { baseCode: 'USD', quoteCode: USDT, rate: 0.5 },
          ];
          expect((await helpers.editCurrencyExchangeRate({ pairs, raw: false })).statusCode).toBe(200);
          const removal = await helpers.removeCurrencyExchangeRate({
            pairs: [
              { baseCode: USDT, quoteCode: 'USD' },
              { baseCode: 'USD', quoteCode: USDT },
            ],
            raw: false,
          });
          expect(removal.statusCode).toBe(200);
        },
      });
    });

    it('limits how often a user saves a source', async () => {
      await createCustom(USDT);

      for (let attempt = 0; attempt < 20; attempt++) {
        const saved = await helpers.setCurrencyRateSource({ code: USDT, payload: { rateSource: 'manual' } });
        expect(saved.statusCode).toBe(200);
      }

      const refused = await helpers.setCurrencyRateSource({ code: USDT, payload: { rateSource: 'manual' } });
      expect(refused.statusCode).toBe(ERROR_CODES.TooManyRequests);
    });

    it('limits how often a user previews a source', async () => {
      await createCustom(USDT);
      const preview = () =>
        helpers.testCurrencyRateSource({
          code: USDT,
          payload: {
            rateSource: 'http',
            config: { urlTemplate: 'https://rates.example.test/{code}', jsonPath: 'price', quoteCurrency: 'USD' },
          },
        });

      // Whatever a preview answers on this instance, only the 21st is refused for the rate.
      for (let attempt = 0; attempt < 20; attempt++) {
        expect((await preview()).statusCode).not.toBe(ERROR_CODES.TooManyRequests);
      }

      expect((await preview()).statusCode).toBe(ERROR_CODES.TooManyRequests);
    });

    it('keeps each user their own source for the same custom code', async () => {
      await createCustom(USDT);
      await helpers.setCurrencyRateSource({
        code: USDT,
        payload: { rateSource: 'peg', config: { pegCurrency: 'USD', factor: 1 } },
      });

      const other = await helpers.signUpSecondUser();
      await helpers.asUser({
        cookies: other.cookies,
        fn: async () => {
          await createCustom(USDT);
          expect(await savedSource({ code: USDT })).toEqual({ rateSource: 'manual', rateSourceConfig: null });
        },
      });

      expect((await savedSource({ code: USDT })).rateSource).toBe('peg');
    });
  });
});

function httpConfig(overrides: Record<string, unknown> = {}) {
  return {
    urlTemplate: 'https://example.com/{code}/{date}',
    jsonPath: 'data.price',
    quoteCurrency: 'USD',
    ...overrides,
  };
}
