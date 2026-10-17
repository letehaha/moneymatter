import { type AccountApiResponse, type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import { logger } from '@js/utils/logger';
import UserExchangeRates from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';
import { redisClient } from '@root/redis-client';
import type { TransactionApiResponse } from '@root/serializers/transactions.serializer';
import { syncHttpRates } from '@root/services/currencies/rate-sources/http-sync';
import { buildLockKey } from '@services/currencies/base-currency-lock';
import * as helpers from '@tests/helpers';
import { http, HttpResponse } from 'msw';

/**
 * No real URL is ever called: the endpoints live on a reserved `.test` host that MSW answers, and
 * the instance runs as self-hosted (outbound guard off) wherever a test needs a request to leave
 * the process. The guard-on tests use URLs the guard refuses before any request is made.
 */
const HOST = 'https://rates.example.test';
const PRICE_URL = `${HOST}/price/{code}?day={date}&quote={quote}`;
const SECRET = 'sk-live-very-secret-key-123';

const USDT = 'USDT';
const BASE = (): string => global.BASE_CURRENCY_CODE;

const todayKey = (): string => new Date().toISOString().slice(0, 10);
const noonOf = ({ day }: { day: string }): string => `${day}T12:00:00.000Z`;

interface SeenRequest {
  url: URL;
  apiKey: string | null;
}

/** Answers the price endpoint with `price` at `data.price` and records the requests it saw. */
const servePrice = ({
  price,
  status = 200,
  body,
}: {
  price?: number | string;
  status?: number;
  body?: () => Response;
}) => {
  const seen: SeenRequest[] = [];
  global.mswMockServer.use(
    http.get(`${HOST}/price/:code`, ({ request }) => {
      seen.push({ url: new URL(request.url), apiKey: request.headers.get('x-api-key') });
      if (body) return body();

      return HttpResponse.json({ data: { price } }, { status });
    }),
  );

  return seen;
};

const createCurrency = async ({ code = USDT, decimals = 6 }: { code?: string; decimals?: number } = {}) => {
  const response = await helpers.createCustomCurrency({ payload: { code, name: code, decimals } });
  expect(response.statusCode).toBe(201);
};

const httpConfig = (overrides: Record<string, unknown> = {}) => ({
  urlTemplate: PRICE_URL,
  jsonPath: 'data.price',
  quoteCurrency: BASE(),
  ...overrides,
});

const useHttp = ({ code = USDT, config = {} }: { code?: string; config?: Record<string, unknown> } = {}) =>
  helpers.setCurrencyRateSource({ code, payload: { rateSource: 'http', config: httpConfig(config) } });

const createAccountIn = async ({ code }: { code: string }) => {
  const response = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ currencyCode: code, name: `${code} account`, initialBalance: 0 }),
    raw: false,
  });
  expect(response.statusCode).toBe(200);

  return (response as unknown as { body: { response: AccountApiResponse } }).body.response;
};

const createTxToday = async ({ accountId, amount }: { accountId: string; amount: number }) => {
  const response = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: accountId as RecordId,
      amount,
      categoryId: global.DEFAULT_CATEGORY_ID,
      transactionType: TRANSACTION_TYPES.expense,
      time: noonOf({ day: todayKey() }),
    }),
    raw: false,
  });
  const result = response as unknown as { statusCode: number; body: { response: TransactionApiResponse[] } };
  if (result.statusCode !== 200) throw new Error(`createTransaction answered ${result.statusCode}`);

  return result.body.response[0]!;
};

const readTx = async ({ id }: { id: string }) =>
  (await helpers.getTransactionById({ id: id as RecordId, raw: true })) as unknown as TransactionApiResponse;

const storedRates = async ({ code = USDT }: { code?: string } = {}) => {
  const { id: userId } = await helpers.getUserInfo({ raw: true });
  const rows = await UserExchangeRates.findAll({ where: { userId, baseCode: code }, raw: true });

  return rows
    .map((row) => ({ day: row.effectiveDate, quote: row.quoteCode, rate: Number(row.rate), source: row.source }))
    .toSorted((a, b) => a.day.localeCompare(b.day));
};

const savedSource = async ({ code = USDT }: { code?: string } = {}) => {
  const entry = (await helpers.getUserCurrencies()).find((item) => item.currencyCode === code);

  return { rateSource: entry?.rateSource, rateSourceConfig: entry?.rateSourceConfig };
};

/** The encrypted headers column, which no endpoint returns. */
const storedHeadersBlob = async ({ code = USDT }: { code?: string } = {}) => {
  const { id: userId } = await helpers.getUserInfo({ raw: true });
  const row = await UsersCurrencies.unscoped().findOne({ where: { userId, currencyCode: code }, raw: true });

  return row?.rateSourceHeadersEncrypted ?? null;
};

const asSelfHost = () => {
  let before: string | undefined;

  beforeEach(() => {
    before = process.env.IS_SELF_HOST;
    process.env.IS_SELF_HOST = 'true';
  });

  afterEach(() => {
    if (before === undefined) delete process.env.IS_SELF_HOST;
    else process.env.IS_SELF_HOST = before;
  });
};

describe('HTTP rate source', () => {
  describe('with the outbound guard on (a cloud instance)', () => {
    beforeEach(() => {
      delete process.env.IS_SELF_HOST;
    });

    it('rejects an http URL when it is saved, and saves nothing', async () => {
      await createCurrency();

      const response = await useHttp({ config: { urlTemplate: 'http://rates.example.test/price/{code}' } });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await savedSource()).toEqual({ rateSource: 'manual', rateSourceConfig: null });
    });

    it('rejects an http URL in a preview, before any request is made', async () => {
      await createCurrency();
      const seen = servePrice({ price: 1 });

      const response = await helpers.testCurrencyRateSource({
        code: USDT,
        payload: { rateSource: 'http', config: httpConfig({ urlTemplate: 'http://rates.example.test/price/{code}' }) },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(seen).toHaveLength(0);
    });

    it.each([
      ['a loopback address', 'https://127.0.0.1/price/{code}'],
      ['a private address', 'https://10.0.0.5/price/{code}'],
      ['a link-local metadata address', 'https://169.254.169.254/latest/{code}'],
      ['an IPv6 loopback', 'https://[::1]/price/{code}'],
    ])('answers a preview of %s with a blocked failure', async (_name, urlTemplate) => {
      await createCurrency();

      const response = await helpers.testCurrencyRateSource({
        code: USDT,
        payload: { rateSource: 'http', config: httpConfig({ urlTemplate }) },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body.response).toMatchObject({ ok: false, reason: 'blocked' });
    });

    it('saves an https URL, and a failed first fetch does not fail the save', async () => {
      await createCurrency();
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);

      try {
        const response = await useHttp({ config: { urlTemplate: 'https://127.0.0.1/price/{code}' } });

        expect(response.statusCode).toBe(200);
        expect(await storedRates()).toEqual([]);
        expect(errorSpy).toHaveBeenCalledWith(
          expect.objectContaining({ message: expect.stringContaining('blocked') }),
          expect.objectContaining({ code: 'HTTP_RATE_SOURCE_FETCH_FAILED' }),
        );
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  describe('on a self-hosted instance', () => {
    asSelfHost();

    describe('POST /user/currencies/:code/rate-source/test', () => {
      it('fetches today with the filled URL and the headers, and saves nothing', async () => {
        await createCurrency();
        const seen = servePrice({ price: 0.000412 });

        const response = await helpers.testCurrencyRateSource({
          code: USDT,
          payload: { rateSource: 'http', config: httpConfig({ headers: { 'X-Api-Key': SECRET } }) },
        });

        expect(response.statusCode).toBe(200);
        expect(response.body.response).toEqual({ ok: true, date: todayKey(), rate: 0.000412, quoteCurrency: BASE() });
        expect(seen).toHaveLength(1);
        expect(seen[0]!.url.pathname).toBe('/price/USDT');
        expect(seen[0]!.url.searchParams.get('day')).toBe(todayKey());
        expect(seen[0]!.url.searchParams.get('quote')).toBe(BASE());
        expect(seen[0]!.apiKey).toBe(SECRET);

        expect(JSON.stringify(response.body)).not.toContain(SECRET);
        expect(await savedSource()).toEqual({ rateSource: 'manual', rateSourceConfig: null });
        expect(await storedRates()).toEqual([]);
        expect(await storedHeadersBlob()).toBeNull();
      });

      it('asks for the day the request names', async () => {
        await createCurrency();
        const seen = servePrice({ price: 3 });

        const response = await helpers.testCurrencyRateSource({
          code: USDT,
          payload: { rateSource: 'http', config: httpConfig(), date: '2026-02-03' },
        });

        expect(response.body.response).toMatchObject({ ok: true, date: '2026-02-03', rate: 3 });
        expect(seen[0]!.url.searchParams.get('day')).toBe('2026-02-03');
      });

      it('reads a price sent as a string and one nested in arrays', async () => {
        await createCurrency();
        global.mswMockServer.use(
          http.get(`${HOST}/price/:code`, () => HttpResponse.json({ rows: [{ p: '42000.50' }] })),
        );

        const response = await helpers.testCurrencyRateSource({
          code: USDT,
          payload: { rateSource: 'http', config: httpConfig({ jsonPath: '$.rows[0].p' }) },
        });

        expect(response.body.response).toMatchObject({ ok: true, rate: 42000.5 });
      });

      it('sends the headers already saved on the source when the request names none', async () => {
        await createCurrency();
        servePrice({ price: 1 });
        await useHttp({ config: { headers: { 'X-Api-Key': SECRET } } });

        const seen = servePrice({ price: 2 });
        const response = await helpers.testCurrencyRateSource({
          code: USDT,
          payload: { rateSource: 'http', config: httpConfig() },
        });

        expect(response.body.response).toMatchObject({ ok: true, rate: 2 });
        expect(seen[0]!.apiKey).toBe(SECRET);
      });

      it.each([
        ['a server that answers 401', () => servePrice({ status: 401, price: 1 }), {}, 'http_status'],
        [
          'a body that is not JSON',
          () => servePrice({ body: () => new HttpResponse('<html>nope</html>', { status: 200 }) }),
          {},
          'not_json',
        ],
        ['a path that leads nowhere', () => servePrice({ price: 1 }), { jsonPath: 'data.cost' }, 'path_not_found'],
        ['a value that is not a number', () => servePrice({ price: 'cheap' }), {}, 'not_a_number'],
        ['a price of zero', () => servePrice({ price: 0 }), {}, 'not_a_number'],
        [
          'a response over 256 KB',
          () =>
            servePrice({
              body: () => new HttpResponse(JSON.stringify({ data: { price: 1 }, pad: 'x'.repeat(300_000) })),
            }),
          {},
          'too_large',
        ],
      ])('answers %s with ok false and the reason', async (_name, serve, configOverrides, reason) => {
        await createCurrency();
        serve();

        const response = await helpers.testCurrencyRateSource({
          code: USDT,
          payload: { rateSource: 'http', config: httpConfig(configOverrides) },
        });

        expect(response.statusCode).toBe(200);
        expect(response.body.response).toMatchObject({ ok: false, reason });
        expect(JSON.stringify(response.body)).not.toContain(HOST);
      });

      it('follows no redirect, so the headers stay with the saved URL', async () => {
        await createCurrency();
        const elsewhere = servePrice({ price: 9 });
        global.mswMockServer.use(
          http.get(
            `${HOST}/moved/:code`,
            () => new HttpResponse(null, { status: 302, headers: { Location: `${HOST}/price/USDT` } }),
          ),
        );

        const response = await helpers.testCurrencyRateSource({
          code: USDT,
          payload: {
            rateSource: 'http',
            config: httpConfig({ urlTemplate: `${HOST}/moved/{code}`, headers: { 'X-Api-Key': SECRET } }),
          },
        });

        expect(response.body.response).toMatchObject({ ok: false });
        expect(elsewhere).toHaveLength(0);
      });

      it('answers 404 for a currency the user does not hold', async () => {
        const response = await helpers.testCurrencyRateSource({
          code: 'NOPE',
          payload: { rateSource: 'http', config: httpConfig() },
        });

        expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
      });

      it('answers 404 for another user custom currency', async () => {
        await createCurrency();
        const other = await helpers.signUpSecondUser();

        await helpers.asUser({
          cookies: other.cookies,
          fn: async () => {
            const response = await helpers.testCurrencyRateSource({
              code: USDT,
              payload: { rateSource: 'http', config: httpConfig() },
            });
            expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
          },
        });
      });

      it.each([
        ['an ISO currency', () => ({ code: BASE(), config: httpConfig() })],
        ['a quote that is not ISO', () => ({ code: USDT, config: httpConfig({ quoteCurrency: 'NOPE' }) })],
        [
          'a template with an unknown placeholder',
          () => ({ code: USDT, config: httpConfig({ urlTemplate: `${HOST}/{day}` }) }),
        ],
        ['a header the HTTP layer owns', () => ({ code: USDT, config: httpConfig({ headers: { Host: 'x' } }) })],
        ['a missing JSON path', () => ({ code: USDT, config: { urlTemplate: PRICE_URL } })],
      ])('rejects %s with 422', async (_name, build) => {
        await createCurrency();
        const { code, config } = build();

        const response = await helpers.testCurrencyRateSource({ code, payload: { rateSource: 'http', config } });

        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      });
    });

    describe('PUT /user/currencies/:code/rate-source', () => {
      it('saves the source, returns the header names and never the values', async () => {
        await createCurrency();
        servePrice({ price: 2 });

        const response = await useHttp({ config: { headers: { 'X-Api-Key': SECRET, Accept: 'application/json' } } });

        expect(response.statusCode).toBe(200);
        expect(response.body.response).toEqual({
          currencyCode: USDT,
          rateSource: 'http',
          rateSourceConfig: { ...httpConfig(), headerNames: ['X-Api-Key', 'Accept'] },
        });
        expect(JSON.stringify(response.body)).not.toContain(SECRET);

        const listed = await helpers.getUserCurrencies();
        expect(JSON.stringify(listed)).not.toContain(SECRET);
        expect(JSON.stringify(listed)).not.toContain('rateSourceHeadersEncrypted');

        const blob = await storedHeadersBlob();
        expect(blob).toEqual(expect.any(String));
        expect(blob).not.toContain(SECRET);
        expect(blob).not.toContain('X-Api-Key');
      });

      it('fetches today and stores the rate in the quote currency, ready for the pair', async () => {
        await createCurrency();
        const seen = servePrice({ price: 2.5 });

        const response = await useHttp();

        expect(response.statusCode).toBe(200);
        expect(seen).toHaveLength(1);
        expect(await storedRates()).toEqual([{ day: todayKey(), quote: BASE(), rate: 2.5, source: 'http' }]);
      });

      it('values the rows waiting for a rate on that day', async () => {
        await createCurrency({ decimals: 2 });
        const account = await createAccountIn({ code: USDT });
        const waiting = await createTxToday({ accountId: account.id, amount: 10 });
        expect((await readTx({ id: waiting.id })).refAmount).toBeNull();
        servePrice({ price: 3 });

        await useHttp();

        const valued = await readTx({ id: waiting.id });
        expect(valued.refAmount).toBe(30);
        expect(valued.refAmountMissing).toBe(false);
      });

      it('keeps the saved headers when an update names none, replaces them when it names some, drops them with {}', async () => {
        await createCurrency();
        servePrice({ price: 1 });
        await useHttp({ config: { headers: { 'X-Api-Key': SECRET } } });
        const firstBlob = await storedHeadersBlob();

        // The editor re-saves the URL without sending the secret again.
        const kept = servePrice({ price: 2 });
        const keepResponse = await useHttp({ config: { jsonPath: 'data.price', urlTemplate: `${PRICE_URL}&v=2` } });
        expect(keepResponse.body.response).toMatchObject({ rateSourceConfig: { headerNames: ['X-Api-Key'] } });
        expect(kept[0]!.apiKey).toBe(SECRET);
        expect(await storedHeadersBlob()).not.toBeNull();

        const replaced = servePrice({ price: 3 });
        await useHttp({ config: { headers: { 'X-Api-Key': 'rotated-key' } } });
        expect(replaced[0]!.apiKey).toBe('rotated-key');
        expect(await storedHeadersBlob()).not.toBe(firstBlob);

        const none = servePrice({ price: 4 });
        const cleared = await useHttp({ config: { headers: {} } });
        expect(cleared.body.response).toMatchObject({ rateSourceConfig: { headerNames: [] } });
        expect(none[0]!.apiKey).toBeNull();
        expect(await storedHeadersBlob()).toBeNull();
      });

      it('drops the headers when the source moves to another kind', async () => {
        await createCurrency();
        servePrice({ price: 1 });
        await useHttp({ config: { headers: { 'X-Api-Key': SECRET } } });

        const response = await helpers.setCurrencyRateSource({ code: USDT, payload: { rateSource: 'manual' } });

        expect(response.statusCode).toBe(200);
        expect(await storedHeadersBlob()).toBeNull();
      });

      it('replaces the rates of the old URL when the URL changes, and keeps them when only the headers do', async () => {
        await createCurrency();
        servePrice({ price: 2 });
        await useHttp({ config: { headers: { 'X-Api-Key': SECRET } } });
        expect(await storedRates()).toEqual([{ day: todayKey(), quote: BASE(), rate: 2, source: 'http' }]);

        // Same URL and path, other headers: the rows stay.
        global.mswMockServer.use(http.get(`${HOST}/price/:code`, () => HttpResponse.json({}, { status: 500 })));
        const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
        try {
          await useHttp({ config: { headers: { 'X-Api-Key': 'other' } } });
          expect(await storedRates()).toEqual([{ day: todayKey(), quote: BASE(), rate: 2, source: 'http' }]);

          // Another URL: the old rows go, and a failed fetch leaves the new history empty.
          await useHttp({ config: { urlTemplate: `${HOST}/price/{code}?other=1` } });
          expect(await storedRates()).toEqual([]);
        } finally {
          errorSpy.mockRestore();
        }
      });

      it('keeps a rate the user entered by hand for the day', async () => {
        await createCurrency();
        const edit = await helpers.editCurrencyExchangeRate({
          pairs: [
            { baseCode: USDT, quoteCode: BASE(), rate: 5, effectiveDate: todayKey() },
            { baseCode: BASE(), quoteCode: USDT, rate: 1 / 5, effectiveDate: todayKey() },
          ],
        });
        expect(edit.statusCode).toBe(200);
        servePrice({ price: 2 });

        await useHttp();

        expect(await storedRates()).toEqual([{ day: todayKey(), quote: BASE(), rate: 5, source: 'manual' }]);
      });

      it('logs a failed first fetch without the URL or the headers, and still saves', async () => {
        await createCurrency();
        servePrice({ status: 500, price: 1 });
        const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);

        try {
          const response = await useHttp({ config: { headers: { 'X-Api-Key': SECRET } } });

          expect(response.statusCode).toBe(200);
          expect((await savedSource()).rateSource).toBe('http');
          expect(await storedRates()).toEqual([]);
          expect(errorSpy).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.stringContaining('http_status') }),
            expect.objectContaining({ code: 'HTTP_RATE_SOURCE_FETCH_FAILED' }),
          );
          expect(
            JSON.stringify(errorSpy.mock.calls.map(([first]) => (first as { message: string }).message)),
          ).not.toMatch(new RegExp(`${SECRET}|rates.example.test`));
        } finally {
          errorSpy.mockRestore();
        }
      });
    });

    describe('backup', () => {
      it('never exports the headers or their names, and ignores any an archive claims', async () => {
        await createCurrency();
        servePrice({ price: 2 });
        await useHttp({ config: { headers: { 'X-Api-Key': SECRET } } });

        const exported = await helpers.exportBackup();
        expect(exported.statusCode).toBe(200);
        const archive = helpers.parseBackupArchive({ buffer: exported.body });
        for (const [, content] of archive.files) {
          expect(content.toString('utf8')).not.toContain(SECRET);
        }
        const held = JSON.parse(archive.files.get('data/users-currencies.json')!.toString('utf8')) as Record<
          string,
          unknown
        >[];
        const usdt = held.find((row) => row.currencyCode === USDT)!;
        expect(usdt).not.toHaveProperty('rateSourceHeadersEncrypted');
        expect(usdt.rateSourceConfig).toMatchObject({ urlTemplate: PRICE_URL, headerNames: [] });

        // An archive that carries a blob and names of its own gets neither.
        archive.files.set(
          'data/users-currencies.json',
          Buffer.from(
            JSON.stringify(
              held.map((row) =>
                row.currencyCode === USDT
                  ? {
                      ...row,
                      rateSourceHeadersEncrypted: 'aa:bb:cc',
                      rateSourceConfig: { ...(row.rateSourceConfig as object), headerNames: ['X-Api-Key'] },
                    }
                  : row,
              ),
            ),
          ),
        );
        await helpers.wipeUserData();
        const restore = await helpers.restoreBackup({
          fileContent: await helpers.repackBackup({ files: archive.files }),
        });
        expect(restore.statusCode).toBe(200);
        const status = await helpers.waitForRestore({ jobId: restore.jobId! });
        expect(status.status).toBe('completed');

        expect(await savedSource()).toEqual({
          rateSource: 'http',
          rateSourceConfig: { ...httpConfig(), headerNames: [] },
        });
        expect(await storedHeadersBlob()).toBeNull();
      });
    });

    describe('another synced source before it', () => {
      it('takes over the rate of a day the other source wrote, with its own tag', async () => {
        await createCurrency();
        const { id: userId } = await helpers.getUserInfo({ raw: true });
        await UserExchangeRates.create({
          userId,
          baseCode: USDT,
          quoteCode: BASE(),
          rate: 7,
          effectiveDate: todayKey(),
          source: 'coingecko',
        });
        servePrice({ price: 2 });

        await useHttp();

        expect(await storedRates()).toEqual([{ day: todayKey(), quote: BASE(), rate: 2, source: 'http' }]);

        // The row now belongs to the HTTP source, so a change of URL removes it with the rest.
        servePrice({ status: 500, price: 1 });
        const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
        try {
          await useHttp({ config: { urlTemplate: `${HOST}/price/{code}?other=1` } });
        } finally {
          errorSpy.mockRestore();
        }
        expect(await storedRates()).toEqual([]);
      });
    });

    describe('POST /user/currencies/:code/rate-source/test with unreadable saved headers', () => {
      it('answers with the reason instead of failing the request', async () => {
        await createCurrency();
        servePrice({ price: 1 });
        await useHttp({ config: { headers: { 'X-Api-Key': SECRET } } });
        const { id: userId } = await helpers.getUserInfo({ raw: true });
        await UsersCurrencies.unscoped().update(
          { rateSourceHeadersEncrypted: 'not-an-encrypted-blob' },
          { where: { userId, currencyCode: USDT } },
        );

        const response = await helpers.testCurrencyRateSource({
          code: USDT,
          payload: { rateSource: 'http', config: httpConfig() },
        });

        expect(response.statusCode).toBe(200);
        expect(response.body.response).toMatchObject({ ok: false, reason: 'headers_unreadable' });
      });
    });

    describe('daily sync', () => {
      it('replaces a changed rate of today, values the rows again and leaves other days alone', async () => {
        await createCurrency({ decimals: 2 });
        const account = await createAccountIn({ code: USDT });
        servePrice({ price: 2 });
        await useHttp();
        const tx = await createTxToday({ accountId: account.id, amount: 10 });
        expect((await readTx({ id: tx.id })).refAmount).toBe(20);

        servePrice({ price: 4 });
        const result = await syncHttpRates();

        expect(result).toMatchObject({ requests: 1, currenciesUpdated: 1, ratesWritten: 1, failures: 0 });
        expect(await storedRates()).toEqual([{ day: todayKey(), quote: BASE(), rate: 4, source: 'http' }]);
        expect((await readTx({ id: tx.id })).refAmount).toBe(40);
      });

      it('does not store a rate for a source that was changed while the request was in flight', async () => {
        await createCurrency();
        servePrice({ price: 2 });
        await useHttp();

        global.mswMockServer.use(
          http.get(`${HOST}/price/:code`, async () => {
            const moved = await helpers.setCurrencyRateSource({ code: USDT, payload: { rateSource: 'manual' } });
            expect(moved.statusCode).toBe(200);

            return HttpResponse.json({ data: { price: 9 } });
          }),
        );
        const result = await syncHttpRates();

        expect(result).toMatchObject({ requests: 1, currenciesUpdated: 0, ratesWritten: 0 });
        expect(await storedRates()).toEqual([{ day: todayKey(), quote: BASE(), rate: 2, source: 'http' }]);
      });

      it('leaves a user alone while their base currency is being changed, and catches up afterwards', async () => {
        await createCurrency({ decimals: 2 });
        const account = await createAccountIn({ code: USDT });
        servePrice({ price: 2 });
        await useHttp();
        const tx = await createTxToday({ accountId: account.id, amount: 10 });
        expect((await readTx({ id: tx.id })).refAmount).toBe(20);

        const { id: userId } = await helpers.getUserInfo({ raw: true });
        await redisClient.set(buildLockKey(userId), 'test-lock');
        try {
          servePrice({ price: 4 });
          const locked = await syncHttpRates();

          expect(locked).toMatchObject({ ratesWritten: 0, currenciesUpdated: 0 });
          expect(await storedRates()).toEqual([{ day: todayKey(), quote: BASE(), rate: 2, source: 'http' }]);
          expect((await readTx({ id: tx.id })).refAmount).toBe(20);
        } finally {
          await redisClient.del(buildLockKey(userId));
        }

        const free = await syncHttpRates();

        expect(free).toMatchObject({ ratesWritten: 1, currenciesUpdated: 1 });
        expect((await readTx({ id: tx.id })).refAmount).toBe(40);
      });

      it('writes nothing when the rate has not changed', async () => {
        await createCurrency();
        servePrice({ price: 2 });
        await useHttp();

        const result = await syncHttpRates();

        expect(result).toMatchObject({ requests: 1, currenciesUpdated: 0, ratesWritten: 0, failures: 0 });
      });

      it('prices rows that waited because the first fetch failed', async () => {
        await createCurrency({ decimals: 2 });
        const account = await createAccountIn({ code: USDT });
        const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
        try {
          servePrice({ status: 503, price: 1 });
          await useHttp();
        } finally {
          errorSpy.mockRestore();
        }
        const waiting = await createTxToday({ accountId: account.id, amount: 10 });
        expect((await readTx({ id: waiting.id })).refAmountMissing).toBe(true);

        servePrice({ price: 3 });
        const result = await syncHttpRates();

        expect(result).toMatchObject({ currenciesUpdated: 1, failures: 0 });
        const valued = await readTx({ id: waiting.id });
        expect(valued.refAmount).toBe(30);
        expect(valued.refAmountMissing).toBe(false);
      });

      it('keeps the last rate and logs when the endpoint fails, without the URL or the headers', async () => {
        await createCurrency();
        servePrice({ price: 2 });
        await useHttp({ config: { headers: { 'X-Api-Key': SECRET } } });
        const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);

        try {
          servePrice({ status: 500, price: 1 });
          const result = await syncHttpRates();

          expect(result).toMatchObject({ failures: 1, ratesWritten: 0 });
          expect(await storedRates()).toEqual([{ day: todayKey(), quote: BASE(), rate: 2, source: 'http' }]);
          expect(errorSpy).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.stringContaining('http_status') }),
            expect.objectContaining({ code: 'HTTP_RATE_SYNC_FAILED' }),
          );
          const logged = JSON.stringify(errorSpy.mock.calls.map(([first]) => (first as { message: string }).message));
          expect(logged).not.toContain(SECRET);
          expect(logged).not.toContain('rates.example.test');
        } finally {
          errorSpy.mockRestore();
        }
      });

      it('goes on with the other currencies when one fails', async () => {
        await createCurrency({ code: 'AAA' });
        await createCurrency({ code: 'BBB' });
        global.mswMockServer.use(
          http.get(`${HOST}/price/:code`, ({ params }) =>
            params.code === 'AAA' ? HttpResponse.json({}, { status: 500 }) : HttpResponse.json({ data: { price: 7 } }),
          ),
        );
        const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);

        try {
          await useHttp({ code: 'AAA' });
          await useHttp({ code: 'BBB' });
          const result = await syncHttpRates();

          expect(result).toMatchObject({ failures: 1, currenciesUpdated: 0, requests: 2 });
          expect(await storedRates({ code: 'AAA' })).toEqual([]);
          expect(await storedRates({ code: 'BBB' })).toEqual([
            { day: todayKey(), quote: BASE(), rate: 7, source: 'http' },
          ]);
        } finally {
          errorSpy.mockRestore();
        }
      });

      it('makes one request for users who share the same request and stores it for each', async () => {
        await createCurrency();
        servePrice({ price: 6 });
        await useHttp({ config: { urlTemplate: `${HOST}/price/{code}`, quoteCurrency: 'USD' } });
        const other = await helpers.provisionSecondUserWithBaseCurrency();
        await helpers.asUser({
          cookies: other.cookies,
          fn: async () => {
            await createCurrency();
            const saved = await useHttp({ config: { urlTemplate: `${HOST}/price/{code}`, quoteCurrency: 'USD' } });
            expect(saved.statusCode).toBe(200);
            expect(await storedRates()).toEqual([{ day: todayKey(), quote: 'USD', rate: 6, source: 'http' }]);
          },
        });

        const requests = servePrice({ price: 8 });
        const result = await syncHttpRates();

        expect(requests).toHaveLength(1);
        expect(result).toMatchObject({ requests: 1, currenciesUpdated: 2, ratesWritten: 2, failures: 0 });
        expect(await storedRates()).toEqual([{ day: todayKey(), quote: 'USD', rate: 8, source: 'http' }]);
        await helpers.asUser({
          cookies: other.cookies,
          fn: async () => {
            expect(await storedRates()).toEqual([{ day: todayKey(), quote: 'USD', rate: 8, source: 'http' }]);
          },
        });
      });

      it('sends each user their own headers, so users with different keys are not merged', async () => {
        await createCurrency();
        await useHttp({ config: { urlTemplate: `${HOST}/price/{code}`, headers: { 'X-Api-Key': 'key-a' } } });
        const other = await helpers.provisionSecondUserWithBaseCurrency();
        await helpers.asUser({
          cookies: other.cookies,
          fn: async () => {
            await createCurrency();
            const saved = await useHttp({
              config: { urlTemplate: `${HOST}/price/{code}`, headers: { 'X-Api-Key': 'key-b' } },
            });
            expect(saved.statusCode).toBe(200);
          },
        });

        const requests = servePrice({ price: 9 });
        const result = await syncHttpRates();

        expect(result.requests).toBe(2);
        expect(requests.map((request) => request.apiKey).toSorted()).toEqual(['key-a', 'key-b']);
      });

      it('does nothing when no currency uses an HTTP source', async () => {
        await createCurrency();

        expect(await syncHttpRates()).toEqual({ requests: 0, currenciesUpdated: 0, ratesWritten: 0, failures: 0 });
      });
    });
  });
});
