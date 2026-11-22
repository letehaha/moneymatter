import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import { logger } from '@js/utils/logger';
import UserExchangeRates from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';
import { redisClient } from '@root/redis-client';
import { buildLockKey } from '@services/currencies/base-currency-lock';
import * as helpers from '@tests/helpers';
import { useSelfHost } from '@tests/helpers/self-host';
import { http, HttpResponse } from 'msw';

/**
 * No real URL is ever called: the endpoints live on a reserved `.test` host that MSW answers, and
 * the instance runs as self-hosted (outbound guard off) wherever a test needs a request to leave
 * the process. The guard-on tests use URLs the guard refuses before any request is made.
 */
const HOST = 'https://rates.example.test';
const PRICE_URL = `${HOST}/price/{code}?day={date}&quote={quote}`;
const SECRET = 'sk-live-very-secret-key-123';
const OTHER_HOST = 'https://elsewhere.example.test';

const USDT = 'USDT';
const BASE = (): string => global.BASE_CURRENCY_CODE;

const { createAccountInCurrency: createAccountIn, dayKey, noonOf, readTx } = helpers;
const todayKey = (): string => dayKey({ daysAgo: 0 });
const yesterdayKey = (): string => dayKey({ daysAgo: 1 });
const OPENING_DAY = dayKey({ daysAgo: 60 });
/** Base-currency units per unit of a new currency, from OPENING_DAY on. */
const OPENING_RATE = 2;

interface SeenRequest {
  url: URL;
  apiKey: string | null;
}

/** Answers the price endpoint with `price` at `data.price` and records the requests it saw. */
const servePrice = ({ price, status = 200, host = HOST }: { price: number; status?: number; host?: string }) => {
  const seen: SeenRequest[] = [];
  global.mswMockServer.use(
    http.get(`${host}/price/:code`, ({ request }) => {
      seen.push({ url: new URL(request.url), apiKey: request.headers.get('x-api-key') });

      return HttpResponse.json({ data: { price } }, { status });
    }),
  );

  return seen;
};

/** The rate the currency needs starts on OPENING_DAY, so today is free for the source's first rate. */
const createCurrency = ({ code = USDT, decimals = 6 }: { code?: string; decimals?: number } = {}) =>
  helpers.addCustomCurrencyFrom({ code, decimals, openingDay: OPENING_DAY, openingRate: OPENING_RATE });

/** An `http` rate of an earlier day, which the source cannot fetch again: it is there only if it was kept. */
const seedHttpRate = async ({ day, rate }: { day: string; rate: number }) => {
  const { id: userId } = await helpers.getUserInfo({ raw: true });
  await UserExchangeRates.create({
    userId,
    baseCode: USDT,
    quoteCode: BASE(),
    rate,
    effectiveDate: day,
    source: 'http',
  });
};

const httpConfig = (overrides: Record<string, unknown> = {}) => ({
  urlTemplate: PRICE_URL,
  jsonPath: 'data.price',
  quoteCurrency: BASE(),
  ...overrides,
});

const useHttp = ({ code = USDT, config = {} }: { code?: string; config?: Record<string, unknown> } = {}) =>
  helpers.setCurrencyRateSource({ code, payload: { rateSource: 'http', config: httpConfig(config) } });

const createExpense = async (params: { accountId: string; amount: number; day?: string }) =>
  (await helpers.createTxOn(params))[0]!;

const storedRates = ({ code = USDT }: { code?: string } = {}) => helpers.storedRates({ code, excludeDay: OPENING_DAY });

const savedSource = ({ code = USDT }: { code?: string } = {}) => helpers.savedSource({ code });

/** The encrypted headers column, which no endpoint returns. */
const storedHeadersBlob = async ({ code = USDT }: { code?: string } = {}) => {
  const { id: userId } = await helpers.getUserInfo({ raw: true });
  const row = await UsersCurrencies.unscoped().findOne({ where: { userId, currencyCode: code }, raw: true });

  return row?.rateSourceHeadersEncrypted ?? null;
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

    it('answers a preview of a private address with a blocked failure', async () => {
      await createCurrency();

      const response = await helpers.testCurrencyRateSource({
        code: USDT,
        payload: { rateSource: 'http', config: httpConfig({ urlTemplate: 'https://10.0.0.5/price/{code}' }) },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body.response).toMatchObject({ ok: false, reason: 'blocked' });
    });

    it('rejects an https URL whose first fetch is blocked, and saves nothing', async () => {
      await createCurrency();
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger);

      try {
        const response = await useHttp({ config: { urlTemplate: 'https://127.0.0.1/price/{code}' } });

        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
        expect(await savedSource()).toEqual({ rateSource: 'manual', rateSourceConfig: null });
        expect(await storedRates()).toEqual([]);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('blocked'));
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe('on a self-hosted instance', () => {
    useSelfHost();

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

      it('answers a failed request with ok false and the reason, without the host', async () => {
        await createCurrency();
        servePrice({ status: 401, price: 1 });

        const response = await helpers.testCurrencyRateSource({
          code: USDT,
          payload: { rateSource: 'http', config: httpConfig() },
        });

        expect(response.statusCode).toBe(200);
        expect(response.body.response).toMatchObject({ ok: false, reason: 'http_status' });
        expect(JSON.stringify(response.body)).not.toContain(HOST);
      });

      it('sends no saved header to a URL on another host', async () => {
        await createCurrency();
        servePrice({ price: 1 });
        await useHttp({ config: { headers: { 'X-Api-Key': SECRET } } });

        const seen = servePrice({ host: OTHER_HOST, price: 2 });
        const response = await helpers.testCurrencyRateSource({
          code: USDT,
          payload: { rateSource: 'http', config: httpConfig({ urlTemplate: `${OTHER_HOST}/price/{code}` }) },
        });

        expect(response.body.response).toMatchObject({ ok: true, rate: 2 });
        expect(seen[0]!.apiKey).toBeNull();
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

      it('takes over the day of the rate the currency was created with, in another quote', async () => {
        const created = await helpers.createCustomCurrency({
          payload: { code: USDT, name: USDT, decimals: 6, rate: { value: OPENING_RATE } },
        });
        expect(created.statusCode).toBe(201);
        expect(await storedRates()).toEqual([
          { day: todayKey(), quote: BASE(), rate: OPENING_RATE, source: 'initial' },
        ]);
        servePrice({ price: 2.5 });

        expect((await useHttp({ config: { quoteCurrency: 'USD' } })).statusCode).toBe(200);

        expect(await storedRates()).toEqual([{ day: todayKey(), quote: 'USD', rate: 2.5, source: 'http' }]);
      });

      it('values the rows a manual rate priced again with the first rate of the source', async () => {
        await createCurrency({ decimals: 2 });
        await helpers.setUserRate({ code: USDT, rate: 2, effectiveDate: yesterdayKey() });
        const account = await createAccountIn({ code: USDT });
        const priced = await createExpense({ accountId: account.id, amount: 10 });
        expect((await readTx({ id: priced.id })).refAmount).toBe(20);
        servePrice({ price: 3 });

        await useHttp();

        expect((await readTx({ id: priced.id })).refAmount).toBe(30);
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

      it('drops the saved headers when an update that names none moves the URL to another host', async () => {
        await createCurrency();
        servePrice({ price: 1 });
        await useHttp({ config: { headers: { 'X-Api-Key': SECRET } } });

        const seen = servePrice({ host: OTHER_HOST, price: 2 });
        const response = await useHttp({ config: { urlTemplate: `${OTHER_HOST}/price/{code}` } });

        expect(response.body.response).toMatchObject({ rateSourceConfig: { headerNames: [] } });
        expect(seen[0]!.apiKey).toBeNull();
        expect(await storedHeadersBlob()).toBeNull();
      });

      it('values the balance history of each past day with the rate in force that day, as its transactions are', async () => {
        await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
        const usdToBase = 4;
        await helpers.setUserRate({ code: 'USD', rate: usdToBase });
        await createCurrency();
        const account = await createAccountIn({ code: USDT });
        const pastDay = dayKey({ daysAgo: 10 });
        const tx = await createExpense({ accountId: account.id, amount: 10, day: pastDay });

        // Today's rate lands in USD; the opening rate stays in the base.
        servePrice({ price: 100 });
        const saved = await useHttp({ config: { quoteCurrency: 'USD' } });
        expect(saved.statusCode).toBe(200);

        expect((await readTx({ id: tx.id })).refAmount).toBe(10 * OPENING_RATE);
        const history = await helpers.getBalanceHistory({ accountId: account.id, raw: true });
        expect(helpers.balanceOn({ rows: history, date: new Date(noonOf({ day: pastDay })) })).toBe(-10 * OPENING_RATE);
        expect(helpers.balanceOn({ rows: history, date: new Date() })).toBe(-10 * 100 * usdToBase);
      });

      it('drops the headers when the source moves to another kind', async () => {
        await createCurrency();
        servePrice({ price: 1 });
        await useHttp({ config: { headers: { 'X-Api-Key': SECRET } } });

        const response = await helpers.setCurrencyRateSource({ code: USDT, payload: { rateSource: 'manual' } });

        expect(response.statusCode).toBe(200);
        expect(await storedHeadersBlob()).toBeNull();
      });

      it('rejects a failed first fetch and changes nothing, answering and logging without the URL or the headers', async () => {
        await createCurrency();
        servePrice({ price: 2 });
        await useHttp({ config: { headers: { 'X-Api-Key': SECRET } } });
        const blob = await storedHeadersBlob();

        servePrice({ status: 500, price: 1 });
        const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
        try {
          const response = await useHttp({
            config: { urlTemplate: `${HOST}/price/{code}?other=1`, headers: { 'X-Api-Key': SECRET } },
          });

          expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
          expect(JSON.stringify(response.body)).not.toMatch(new RegExp(`${SECRET}|rates.example.test`));
          expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('http_status'));
          expect(JSON.stringify(warnSpy.mock.calls)).not.toMatch(new RegExp(`${SECRET}|rates.example.test`));
        } finally {
          warnSpy.mockRestore();
        }

        expect((await savedSource()).rateSourceConfig).toMatchObject({
          urlTemplate: PRICE_URL,
          headerNames: ['X-Api-Key'],
        });
        expect(await storedHeadersBlob()).toBe(blob);
        expect(await storedRates()).toEqual([{ day: todayKey(), quote: BASE(), rate: 2, source: 'http' }]);
      });

      describe('the stored history when the source is saved again', () => {
        const keptRows = () => [
          { day: yesterdayKey(), quote: BASE(), rate: 1, source: 'http' },
          { day: todayKey(), quote: BASE(), rate: 3, source: 'http' },
        ];
        const queried = `${HOST}/price/{code}?quote={quote}`;

        /** Saves the source with `config`, keeps an earlier day of its history, and serves today's next price. */
        const saveWithHistory = async ({ config = {} }: { config?: Record<string, unknown> } = {}) => {
          await createCurrency();
          servePrice({ price: 2 });
          expect((await useHttp({ config })).statusCode).toBe(200);
          await seedHttpRate({ day: yesterdayKey(), rate: 1 });
          global.mswMockServer.use(http.get(`${HOST}/*`, () => HttpResponse.json({ data: { price: 3, last: 3 } })));
        };

        it.each([
          ['the headers', { headers: { 'X-Api-Key': 'rotated' } }],
          ['the value of a key in the URL query', { urlTemplate: `${queried}&apikey=new-key` }],
          ['the path of the URL', { urlTemplate: `${HOST}/price/{code}/last?quote={quote}` }],
          ['the JSON path', { jsonPath: 'data.last' }],
        ])('keeps the history and replaces only today when %s changes', async (_label, change) => {
          await saveWithHistory({ config: { urlTemplate: queried, headers: { 'X-Api-Key': SECRET } } });

          const saved = await useHttp({ config: { urlTemplate: queried, ...change } });

          expect(saved.statusCode).toBe(200);
          expect(await storedRates()).toEqual(keptRows());
        });

        it('keeps the history when the same config is selected again after another source', async () => {
          await saveWithHistory();
          const manual = await helpers.setCurrencyRateSource({ code: USDT, payload: { rateSource: 'manual' } });
          expect(manual.statusCode).toBe(200);

          const again = await useHttp();

          expect(again.statusCode).toBe(200);
          expect(await storedRates()).toEqual(keptRows());
        });
      });

      it('keeps a rate the user entered by hand for the day', async () => {
        await createCurrency();
        await helpers.setUserRate({ code: USDT, rate: 5, effectiveDate: todayKey() });
        servePrice({ price: 2 });

        await useHttp();

        expect(await storedRates()).toEqual([{ day: todayKey(), quote: BASE(), rate: 5, source: 'manual' }]);
      });
    });

    describe('backup', () => {
      it('exports the header names but never their values; a restore drops the names and warns', async () => {
        await createCurrency();
        servePrice({ price: 2 });
        await useHttp({ config: { headers: { 'X-Api-Key': SECRET } } });

        const exported = await helpers.exportBackup();
        expect(exported.statusCode).toBe(200);
        const archive = helpers.parseBackupArchive({ buffer: exported.body });
        for (const [, content] of archive.files) {
          expect(content.toString('utf8')).not.toContain(SECRET);
        }
        const held = archive.readData({ name: 'users-currencies' }) as Record<string, unknown>[];
        const usdt = held.find((row) => row.currencyCode === USDT)!;
        expect(usdt).not.toHaveProperty('rateSourceHeadersEncrypted');
        expect(usdt.rateSourceConfig).toMatchObject({ urlTemplate: PRICE_URL, headerNames: ['X-Api-Key'] });

        // An archive that carries a blob of its own does not restore it.
        archive.files.set(
          'data/users-currencies.json',
          Buffer.from(
            JSON.stringify(
              held.map((row) => (row.currencyCode === USDT ? { ...row, rateSourceHeadersEncrypted: 'aa:bb:cc' } : row)),
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
        expect(status.summary?.warnings).toContainEqual({
          code: 'rate_source_headers_dropped',
          table: 'users-currencies',
          count: 1,
        });

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
        const tx = await createExpense({ accountId: account.id, amount: 10 });
        expect((await readTx({ id: tx.id })).refAmount).toBe(20);

        servePrice({ price: 4 });
        const result = await helpers.syncRateSources({ source: 'http' });

        expect(result).toMatchObject({ currenciesUpdated: 1, ratesWritten: 1, failures: 0 });
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
        const result = await helpers.syncRateSources({ source: 'http' });

        expect(result).toMatchObject({ currenciesUpdated: 0, ratesWritten: 0 });
        expect(await storedRates()).toEqual([{ day: todayKey(), quote: BASE(), rate: 2, source: 'http' }]);
      });

      it('leaves a user alone while their base currency is being changed, and catches up afterwards', async () => {
        await createCurrency({ decimals: 2 });
        const account = await createAccountIn({ code: USDT });
        servePrice({ price: 2 });
        await useHttp();
        const tx = await createExpense({ accountId: account.id, amount: 10 });
        expect((await readTx({ id: tx.id })).refAmount).toBe(20);

        const { id: userId } = await helpers.getUserInfo({ raw: true });
        await redisClient.set(buildLockKey(userId), 'test-lock');
        try {
          servePrice({ price: 4 });
          const locked = await helpers.syncRateSources({ source: 'http' });

          expect(locked).toMatchObject({ ratesWritten: 0, currenciesUpdated: 0 });
          expect(await storedRates()).toEqual([{ day: todayKey(), quote: BASE(), rate: 2, source: 'http' }]);
          expect((await readTx({ id: tx.id })).refAmount).toBe(20);
        } finally {
          await redisClient.del(buildLockKey(userId));
        }

        const free = await helpers.syncRateSources({ source: 'http' });

        expect(free).toMatchObject({ ratesWritten: 1, currenciesUpdated: 1 });
        expect((await readTx({ id: tx.id })).refAmount).toBe(40);
      });

      it('writes nothing when the rate has not changed', async () => {
        await createCurrency();
        servePrice({ price: 2 });
        await useHttp();

        const result = await helpers.syncRateSources({ source: 'http' });

        expect(result).toMatchObject({ currenciesUpdated: 0, ratesWritten: 0, failures: 0 });
      });

      it('keeps the last rate and logs when the endpoint fails, without the URL or the headers', async () => {
        await createCurrency();
        servePrice({ price: 2 });
        await useHttp({ config: { headers: { 'X-Api-Key': SECRET } } });
        const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);

        try {
          servePrice({ status: 500, price: 1 });
          const result = await helpers.syncRateSources({ source: 'http' });

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
        servePrice({ price: 7 });
        await useHttp({ code: 'AAA' });
        await useHttp({ code: 'BBB' });
        global.mswMockServer.use(
          http.get(`${HOST}/price/:code`, ({ params }) =>
            params.code === 'AAA' ? HttpResponse.json({}, { status: 500 }) : HttpResponse.json({ data: { price: 7 } }),
          ),
        );
        const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);

        try {
          const result = await helpers.syncRateSources({ source: 'http' });

          expect(result).toMatchObject({ failures: 1, currenciesUpdated: 0 });
          expect(await storedRates({ code: 'AAA' })).toEqual([
            { day: todayKey(), quote: BASE(), rate: 7, source: 'http' },
          ]);
          expect(await storedRates({ code: 'BBB' })).toEqual([
            { day: todayKey(), quote: BASE(), rate: 7, source: 'http' },
          ]);
        } finally {
          errorSpy.mockRestore();
        }
      });

      it('stores the rate for each user of the same request', async () => {
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
        const result = await helpers.syncRateSources({ source: 'http' });

        expect(requests).toHaveLength(2);
        expect(result).toEqual({ currenciesUpdated: 2, ratesWritten: 2, failures: 0 });
        expect(await storedRates()).toEqual([{ day: todayKey(), quote: 'USD', rate: 8, source: 'http' }]);
        await helpers.asUser({
          cookies: other.cookies,
          fn: async () => {
            expect(await storedRates()).toEqual([{ day: todayKey(), quote: 'USD', rate: 8, source: 'http' }]);
          },
        });
      });

      it('sends each user their own headers', async () => {
        await createCurrency();
        servePrice({ price: 9 });
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
        await helpers.syncRateSources({ source: 'http' });

        expect(requests.map((request) => request.apiKey).toSorted()).toEqual(['key-a', 'key-b']);
      });

      it('does nothing when no currency uses an HTTP source', async () => {
        await createCurrency();

        expect(await helpers.syncRateSources({ source: 'http' })).toEqual({
          currenciesUpdated: 0,
          ratesWritten: 0,
          failures: 0,
        });
      });
    });
  });
});
