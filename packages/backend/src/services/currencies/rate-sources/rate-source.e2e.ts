import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import type { ErrorResponse } from '@tests/helpers/common';
import { http, HttpResponse } from 'msw';

const USDT = 'USDT';
const USDC = 'USDC';

const createCustom = (code: string) =>
  helpers.createCustomCurrency({ payload: { code, name: `${code} coin`, decimals: 6, rate: { value: 1 } }, raw: true });

/** Answers every request to the test host with a price at `data.price`, `data.rates[0].price` and `bitcoin.usd`. */
const serveHttpPrice = () => {
  global.mswMockServer.use(
    http.get('https://rates.example.test/*', () =>
      HttpResponse.json({ data: { price: 1.5, rates: [{ price: 1.5 }] }, bitcoin: { usd: 1.5 } }),
    ),
  );
};

const { savedSource } = helpers;

const errorOf = (response: { body: { response: unknown } }) => response.body.response as ErrorResponse;

describe('PUT /user/currencies/:code/rate-source', () => {
  describe('defaults', () => {
    it('starts a custom currency on manual rates', async () => {
      await createCustom(USDT);

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
  });

  describe('ISO currencies', () => {
    it.each([
      ['manual', { rateSource: 'manual' }],
      ['peg', { rateSource: 'peg', config: { pegCurrency: 'USD', factor: 1 } }],
      ['coingecko', { rateSource: 'coingecko', config: { coinId: 'bitcoin' } }],
      ['http', { rateSource: 'http', config: { urlTemplate: 'https://example.com/{date}', jsonPath: 'price' } }],
    ])('rejects a %s source with 422 and leaves the currency alone', async (_name, payload) => {
      const code = global.BASE_CURRENCY_CODE;
      const before = await helpers.getUserCurrencies();

      const response = await helpers.setCurrencyRateSource({ code, payload });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await helpers.getUserCurrencies()).toEqual(before);
    });
  });

  describe('invalid requests', () => {
    it.each([
      ['an unknown source', { rateSource: 'oracle' }],
      [
        'an HTTP URL with credentials',
        { rateSource: 'http', config: httpConfig({ urlTemplate: 'https://user:pass@example.com/{date}' }) },
      ],
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

    it('rejects a peg to a custom currency, itself included', async () => {
      await createCustom(USDT);
      await createCustom(USDC);

      for (const pegCurrency of [USDT, USDC]) {
        const response = await helpers.setCurrencyRateSource({
          code: USDT,
          payload: { rateSource: 'peg', config: { pegCurrency, factor: 1 } },
        });

        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      }
      expect(await savedSource({ code: USDT })).toEqual({ rateSource: 'manual', rateSourceConfig: null });
    });

    it('rejects a peg to a code the user cannot use', async () => {
      await createCustom(USDT);

      const unknown = await helpers.setCurrencyRateSource({
        code: USDT,
        payload: { rateSource: 'peg', config: { pegCurrency: 'NOPE', factor: 1 } },
      });
      expect(unknown.statusCode).toBe(ERROR_CODES.ValidationError);

      // Another user's custom code reads exactly like an unknown one.
      const other = await helpers.provisionSecondUserWithBaseCurrency();
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
      const other = await helpers.provisionSecondUserWithBaseCurrency();
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
          await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
          const created = await helpers.createCustomCurrency({
            payload: { code: USDT, name: 'USDT coin', decimals: 6, rate: { value: 2, quoteCode: 'USD' } },
          });
          expect(created.statusCode).toBe(201);

          const peg = await helpers.setCurrencyRateSource({
            code: USDT,
            payload: { rateSource: 'peg', config: { pegCurrency: 'USD', factor: 1 } },
          });
          expect(peg.statusCode).toBe(200);
          expect((await savedSource({ code: USDT })).rateSource).toBe('peg');

          // A manual rate edit for the same user reaches the same recompute.
          await helpers.setCurrencyRateSource({ code: USDT, payload: { rateSource: 'manual' } });
          const pairs = [
            { baseCode: USDT, quoteCode: 'USD', rate: 2 },
            { baseCode: 'USD', quoteCode: USDT, rate: 0.5 },
          ];
          expect((await helpers.editCurrencyExchangeRate({ pairs, raw: false })).statusCode).toBe(200);
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
      serveHttpPrice();
      const preview = () =>
        helpers.testCurrencyRateSource({
          code: USDT,
          payload: {
            rateSource: 'http',
            config: { urlTemplate: 'https://rates.example.test/{code}', jsonPath: 'price', quoteCurrency: 'USD' },
          },
        });

      await helpers.withSelfHost(async () => {
        for (let attempt = 0; attempt < 20; attempt++) {
          expect((await preview()).statusCode).not.toBe(ERROR_CODES.TooManyRequests);
        }

        expect((await preview()).statusCode).toBe(ERROR_CODES.TooManyRequests);
      });
    });

    it('keeps each user their own source for the same custom code', async () => {
      await createCustom(USDT);
      await helpers.setCurrencyRateSource({
        code: USDT,
        payload: { rateSource: 'peg', config: { pegCurrency: 'USD', factor: 1 } },
      });

      const other = await helpers.provisionSecondUserWithBaseCurrency();
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
