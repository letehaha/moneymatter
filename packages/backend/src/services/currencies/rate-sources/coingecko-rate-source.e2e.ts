import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import { logger } from '@js/utils/logger';
import { PNG_1X1_BYTES } from '@tests/fixtures/logo-images';
import * as helpers from '@tests/helpers';
import { http, HttpResponse } from 'msw';

const { searchGet, priceGet, getRange } = helpers.coingeckoMock;
const { coingeckoHistory: history, createAccountInCurrency: createAccountIn, dayKey, readTx, savedSource } = helpers;

const BASE = (): string => global.BASE_CURRENCY_CODE;
const NEW_BASE = 'EUR';
const AED_PER_USD = 4;
const EUR_PER_USD = 0.5;

// Distinct, recent days that no other suite seeds.
const DAY_1 = dayKey({ daysAgo: 33 });
const DAY_2 = dayKey({ daysAgo: 32 });
const DAY_3 = dayKey({ daysAgo: 31 });
const BEFORE_HISTORY = dayKey({ daysAgo: 40 });
const OPENING_DAY = dayKey({ daysAgo: 60 });
const YESTERDAY = dayKey({ daysAgo: 1 });
const TODAY = dayKey({ daysAgo: 0 });
const SEEDED_DAYS = [BEFORE_HISTORY, DAY_1, DAY_2, DAY_3];
/** Base-currency units per unit of a new currency, from OPENING_DAY on. */
const OPENING_RATE = 2;

/** The rate the currency needs starts on OPENING_DAY, before every day a test prices. */
const createCurrency = ({ code, decimals = 8 }: { code: string; decimals?: number }) =>
  helpers.addCustomCurrencyFrom({ code, decimals, openingDay: OPENING_DAY, openingRate: OPENING_RATE });

const createTx = async (params: { accountId: string; amount: number; day: string }) =>
  (await helpers.createTxOn(params))[0]!;

const storedRates = ({ code }: { code: string }) => helpers.storedRates({ code, excludeDay: OPENING_DAY });

const useCoingecko = ({
  code,
  coinId = 'bitcoin',
  quoteCurrency,
}: {
  code: string;
  coinId?: string;
  quoteCurrency?: string;
}) =>
  helpers.setCurrencyRateSource({
    code,
    payload: { rateSource: 'coingecko', config: { coinId, ...(quoteCurrency ? { quoteCurrency } : {}) } },
  });

const logoOf = async ({ code }: { code: string }) =>
  (await helpers.getUserCurrencies()).find((item) => item.currencyCode === code)!.logoImageId;

/** CoinGecko's image host answers every coin image with a 1x1 PNG, and records the paths it served. */
const serveCoinImages = ({ status = 200 }: { status?: number } = {}) => {
  const seen: string[] = [];
  global.mswMockServer.use(
    http.get('https://coin-images.coingecko.com/*', ({ request }) => {
      seen.push(new URL(request.url).pathname);

      return new HttpResponse(new Uint8Array(PNG_1X1_BYTES), { status, headers: { 'content-type': 'image/png' } });
    }),
  );

  return seen;
};

const saveWithLogo = ({ code, logoUrl }: { code: string; logoUrl: unknown }) =>
  helpers.setCurrencyRateSource({
    code,
    payload: { rateSource: 'coingecko', config: { coinId: 'bitcoin' }, logoUrl },
  });

describe('CoinGecko rate source', () => {
  beforeEach(async () => {
    helpers.resetCoingeckoMock();
    await helpers.addUserCurrencies({ currencyCodes: ['USD', NEW_BASE], raw: true });
    for (const day of SEEDED_DAYS) {
      await helpers.seedUsdExchangeRates({
        date: new Date(`${day}T00:00:00.000Z`),
        ratesPerUsd: { AED: AED_PER_USD, EUR: EUR_PER_USD },
      });
    }
  });

  afterEach(async () => {
    await helpers.clearExchangeRatesForDates({ dates: SEEDED_DAYS.map((day) => new Date(`${day}T00:00:00.000Z`)) });
  });

  describe('GET /user/currencies/coingecko/search', () => {
    it('lists the canonical coins that match, without wrapped copies', async () => {
      searchGet.mockResolvedValue({
        coins: [
          {
            id: 'bitcoin',
            symbol: 'btc',
            name: 'Bitcoin',
            large: 'https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png',
            market_cap_rank: 1,
          },
          { id: 'wrapped-bitcoin', symbol: 'wbtc', name: 'Wrapped Bitcoin', market_cap_rank: 15 },
        ],
      });

      const response = await helpers.searchCoingeckoCoins({ query: 'btc', raw: false });

      expect(response.statusCode).toBe(200);
      expect(response.body.response).toEqual([
        {
          coinId: 'bitcoin',
          symbol: 'BTC',
          name: 'Bitcoin',
          logoUrl: 'https://coin-images.coingecko.com/coins/images/1/small/bitcoin.png',
          marketCapRank: 1,
        },
      ]);
      expect(searchGet).toHaveBeenCalledWith({ query: 'btc' });
    });

    it('answers an empty list when nothing matches', async () => {
      const response = await helpers.searchCoingeckoCoins({ query: 'nothing-like-this', raw: false });

      expect(response.statusCode).toBe(200);
      expect(response.body.response).toEqual([]);
    });

    it('rejects a blank query', async () => {
      const response = await helpers.searchCoingeckoCoins({ query: '   ', raw: false });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(searchGet).not.toHaveBeenCalled();
    });

    it('answers 503 on an instance without a CoinGecko key', async () => {
      const key = process.env.COINGECKO_API_KEY;
      delete process.env.COINGECKO_API_KEY;
      try {
        const response = await helpers.searchCoingeckoCoins({ query: 'btc', raw: false });

        expect(response.statusCode).toBe(ERROR_CODES.ServiceUnavailable);
      } finally {
        process.env.COINGECKO_API_KEY = key;
      }
    });
  });

  describe('configuring the source', () => {
    it('backfills the history and values the saved transactions again with it', async () => {
      await createCurrency({ code: 'BTC' });
      const account = await createAccountIn({ code: 'BTC' });
      const saved = await createTx({ accountId: account.id, amount: 0.5, day: DAY_2 });
      const beforeHistory = await createTx({ accountId: account.id, amount: 1, day: BEFORE_HISTORY });
      expect(saved.refAmount).toBe(0.5 * OPENING_RATE);

      getRange.mockResolvedValue(
        history([
          [DAY_1, 10],
          [DAY_2, 20],
          [DAY_3, 30],
        ]),
      );
      const response = await useCoingecko({ code: 'BTC' });

      expect(response.statusCode).toBe(200);
      expect(response.body.response).toEqual({
        currencyCode: 'BTC',
        rateSource: 'coingecko',
        rateSourceConfig: { coinId: 'bitcoin', quoteCurrency: 'USD' },
      });
      expect(getRange).toHaveBeenCalledTimes(1);
      expect(getRange).toHaveBeenCalledWith('bitcoin', expect.objectContaining({ vs_currency: 'usd' }));
      expect(await storedRates({ code: 'BTC' })).toEqual([
        { day: DAY_1, quote: 'USD', rate: 10, source: 'coingecko' },
        { day: DAY_2, quote: 'USD', rate: 20, source: 'coingecko' },
        { day: DAY_3, quote: 'USD', rate: 30, source: 'coingecko' },
      ]);

      // 0.5 BTC at 20 USD, crossed into the base at the market rate of the day.
      expect((await readTx({ id: saved.id })).refAmount).toBe(0.5 * 20 * AED_PER_USD);
      // A day before the history keeps the rate that applied to it.
      expect((await readTx({ id: beforeHistory.id })).refAmount).toBe(OPENING_RATE);

      const next = await createTx({ accountId: account.id, amount: 1, day: DAY_3 });
      expect(next.refAmount).toBe(30 * AED_PER_USD);
    });

    it.each([
      ['fails', () => getRange.mockRejectedValue(new Error('CoinGecko is down'))],
      ['returns no price', () => getRange.mockResolvedValue({ prices: [] })],
    ])('rejects the save and changes nothing when the backfill %s', async (_name, arrange) => {
      await createCurrency({ code: 'BTC' });
      const account = await createAccountIn({ code: 'BTC' });
      const tx = await createTx({ accountId: account.id, amount: 2, day: DAY_2 });
      arrange();

      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
      try {
        const response = await useCoingecko({ code: 'BTC' });

        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      } finally {
        warnSpy.mockRestore();
      }

      expect((await savedSource({ code: 'BTC' })).rateSource).toBe('manual');
      expect(await storedRates({ code: 'BTC' })).toEqual([]);
      expect((await readTx({ id: tx.id })).refAmount).toBe(2 * OPENING_RATE);
    });

    it('keeps the history of the coin in force when a switch to another coin brings no price', async () => {
      await createCurrency({ code: 'BTC' });
      getRange.mockResolvedValue(history([[DAY_1, 10]]));
      await useCoingecko({ code: 'BTC' });

      getRange.mockResolvedValue({ prices: [] });
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
      try {
        expect((await useCoingecko({ code: 'BTC', coinId: 'ethereum' })).statusCode).toBe(ERROR_CODES.ValidationError);
      } finally {
        warnSpy.mockRestore();
      }

      expect((await savedSource({ code: 'BTC' })).rateSourceConfig).toEqual({
        coinId: 'bitcoin',
        quoteCurrency: 'USD',
      });
      expect(await storedRates({ code: 'BTC' })).toEqual([{ day: DAY_1, quote: 'USD', rate: 10, source: 'coingecko' }]);
    });

    it('answers 409 and keeps the save that landed while the first fetch was running', async () => {
      await createCurrency({ code: 'BTC' });
      getRange.mockImplementation(async () => {
        await helpers.pegTo({ code: 'BTC', pegCurrency: 'USD', factor: 2 });

        return history([[DAY_1, 10]]);
      });

      const response = await useCoingecko({ code: 'BTC' });

      expect(response.statusCode).toBe(ERROR_CODES.ConflictError);
      expect(await savedSource({ code: 'BTC' })).toEqual({
        rateSource: 'peg',
        rateSourceConfig: { pegCurrency: 'USD', factor: 2 },
      });
      expect(await storedRates({ code: 'BTC' })).toEqual([]);
    });

    it('rejects a quote currency that is not ISO', async () => {
      await createCurrency({ code: 'BTC' });
      await createCurrency({ code: 'SAT' });

      const response = await useCoingecko({ code: 'BTC', quoteCurrency: 'SAT' });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(getRange).not.toHaveBeenCalled();
    });

    it('answers 503 and saves nothing on an instance without a CoinGecko key', async () => {
      await createCurrency({ code: 'BTC' });

      const key = process.env.COINGECKO_API_KEY;
      delete process.env.COINGECKO_API_KEY;
      try {
        const response = await useCoingecko({ code: 'BTC' });

        expect(response.statusCode).toBe(ERROR_CODES.ServiceUnavailable);
      } finally {
        process.env.COINGECKO_API_KEY = key;
      }
      expect((await savedSource({ code: 'BTC' })).rateSource).toBe('manual');
      expect(getRange).not.toHaveBeenCalled();
    });

    it('does not fetch again when the same source is saved twice', async () => {
      await createCurrency({ code: 'BTC' });
      getRange.mockResolvedValue(history([[DAY_1, 10]]));

      await useCoingecko({ code: 'BTC' });
      await useCoingecko({ code: 'BTC' });

      expect(getRange).toHaveBeenCalledTimes(1);
    });

    it('leaves a rate the user set by hand alone and replaces the history of another coin', async () => {
      await createCurrency({ code: 'BTC' });
      const account = await createAccountIn({ code: 'BTC' });
      await helpers.setUserRate({ code: 'BTC', quote: 'USD', rate: 99, effectiveDate: DAY_1 });

      getRange.mockResolvedValue(
        history([
          [DAY_1, 10],
          [DAY_2, 20],
        ]),
      );
      await useCoingecko({ code: 'BTC' });
      expect(await storedRates({ code: 'BTC' })).toEqual([
        { day: DAY_1, quote: 'USD', rate: 99, source: 'manual' },
        { day: DAY_2, quote: 'USD', rate: 20, source: 'coingecko' },
      ]);

      getRange.mockResolvedValue(
        history([
          [DAY_2, 500],
          [DAY_3, 600],
        ]),
      );
      await useCoingecko({ code: 'BTC', coinId: 'ethereum' });

      // The old coin's day is gone, the manual one stays, and the new coin's days replace the rest.
      expect(await storedRates({ code: 'BTC' })).toEqual([
        { day: DAY_1, quote: 'USD', rate: 99, source: 'manual' },
        { day: DAY_2, quote: 'USD', rate: 500, source: 'coingecko' },
        { day: DAY_3, quote: 'USD', rate: 600, source: 'coingecko' },
      ]);
      const tx = await createTx({ accountId: account.id, amount: 1, day: DAY_3 });
      expect(tx.refAmount).toBe(600 * AED_PER_USD);
    });
  });

  describe('the coin logo', () => {
    const LOGO = 'https://coin-images.coingecko.com/coins/images/1/small/bitcoin.png';
    const OTHER_LOGO = 'https://coin-images.coingecko.com/coins/images/279/small/ethereum.png';
    const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    beforeEach(() => {
      getRange.mockResolvedValue(history([[DAY_1, 10]]));
    });

    it('downloads the logo of the picked coin and stores it as the currency logo image', async () => {
      await createCurrency({ code: 'BTC' });
      const seen = serveCoinImages();

      const response = await saveWithLogo({ code: 'BTC', logoUrl: LOGO });

      expect(response.statusCode).toBe(200);
      expect(response.body.response).toEqual({
        currencyCode: 'BTC',
        rateSource: 'coingecko',
        rateSourceConfig: { coinId: 'bitcoin', quoteCurrency: 'USD' },
      });
      expect(seen).toEqual(['/coins/images/1/small/bitcoin.png']);
      const logoImageId = await logoOf({ code: 'BTC' });
      expect(logoImageId).toMatch(UUID_PATTERN);
      expect((await helpers.listCustomCurrencies({ raw: true })).find((item) => item.code === 'BTC')).toMatchObject({
        logoImageId,
        logoDomain: null,
        logoInitials: null,
      });
    });

    it('stores the logo when the same source is saved again, without fetching the rates again', async () => {
      await createCurrency({ code: 'BTC' });
      serveCoinImages();
      await useCoingecko({ code: 'BTC' });
      expect(await logoOf({ code: 'BTC' })).toBeNull();

      const response = await saveWithLogo({ code: 'BTC', logoUrl: LOGO });

      expect(response.statusCode).toBe(200);
      expect(await logoOf({ code: 'BTC' })).toMatch(UUID_PATTERN);
      expect(getRange).toHaveBeenCalledTimes(1);
    });

    it('replaces the logo with the one of the next coin', async () => {
      await createCurrency({ code: 'BTC' });
      serveCoinImages();
      await saveWithLogo({ code: 'BTC', logoUrl: LOGO });
      const first = await logoOf({ code: 'BTC' });

      await helpers.setCurrencyRateSource({
        code: 'BTC',
        payload: { rateSource: 'coingecko', config: { coinId: 'ethereum' }, logoUrl: OTHER_LOGO },
      });

      const next = await logoOf({ code: 'BTC' });
      expect(next).toMatch(UUID_PATTERN);
      expect(next).not.toBe(first);
    });

    it('keeps the current logo when the save names none, and clears the image on null', async () => {
      await createCurrency({ code: 'BTC' });
      serveCoinImages();
      await saveWithLogo({ code: 'BTC', logoUrl: LOGO });
      const stored = await logoOf({ code: 'BTC' });

      const kept = await helpers.setCurrencyRateSource({
        code: 'BTC',
        payload: { rateSource: 'coingecko', config: { coinId: 'ethereum' } },
      });
      expect(kept.statusCode).toBe(200);
      expect(await logoOf({ code: 'BTC' })).toBe(stored);

      const cleared = await saveWithLogo({ code: 'BTC', logoUrl: null });
      expect(cleared.statusCode).toBe(200);
      expect(await logoOf({ code: 'BTC' })).toBeNull();
    });

    it('keeps the logo when the currency goes back to manual or to a peg', async () => {
      await createCurrency({ code: 'BTC' });
      serveCoinImages();
      await saveWithLogo({ code: 'BTC', logoUrl: LOGO });
      const stored = await logoOf({ code: 'BTC' });

      expect((await helpers.setCurrencyRateSource({ code: 'BTC', payload: { rateSource: 'manual' } })).statusCode).toBe(
        200,
      );
      expect(await logoOf({ code: 'BTC' })).toBe(stored);

      const peg = await helpers.setCurrencyRateSource({
        code: 'BTC',
        payload: { rateSource: 'peg', config: { pegCurrency: 'USD', factor: 2 } },
      });
      expect(peg.statusCode).toBe(200);
      expect(await logoOf({ code: 'BTC' })).toBe(stored);
    });

    it('saves the source and keeps the logo when the image host fails', async () => {
      await createCurrency({ code: 'BTC' });
      serveCoinImages({ status: 500 });

      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
      try {
        const response = await saveWithLogo({ code: 'BTC', logoUrl: LOGO });

        expect(response.statusCode).toBe(200);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('coin logo was not downloaded'));
      } finally {
        warnSpy.mockRestore();
      }

      expect((await savedSource({ code: 'BTC' })).rateSource).toBe('coingecko');
      expect(await logoOf({ code: 'BTC' })).toBeNull();
    });

    it('refuses a logo that is not an https URL and saves nothing', async () => {
      await createCurrency({ code: 'BTC' });

      for (const logoUrl of ['http://example.com/a.png', 5]) {
        const response = await saveWithLogo({ code: 'BTC', logoUrl });

        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      }

      expect((await savedSource({ code: 'BTC' })).rateSource).toBe('manual');
      expect(await logoOf({ code: 'BTC' })).toBeNull();
      expect(getRange).not.toHaveBeenCalled();
    });

    it('refuses a logo on a source other than CoinGecko', async () => {
      await createCurrency({ code: 'BTC' });

      const response = await helpers.setCurrencyRateSource({
        code: 'BTC',
        payload: { rateSource: 'manual', logoUrl: LOGO },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await logoOf({ code: 'BTC' })).toBeNull();
    });

    it('saves no logo on an ISO currency, which cannot take a CoinGecko source', async () => {
      const response = await helpers.setCurrencyRateSource({
        code: 'EUR',
        payload: { rateSource: 'coingecko', config: { coinId: 'bitcoin' }, logoUrl: LOGO },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await logoOf({ code: 'EUR' })).toBeNull();
    });
  });

  describe('the rate the currency was created with', () => {
    const createdToday = ({ code }: { code: string }) =>
      helpers.addCustomCurrency({ code, decimals: 8, rate: OPENING_RATE });

    it('gives way to the first source on its day, in another quote, beside manual rates', async () => {
      await createdToday({ code: 'BTC' });
      await helpers.setUserRate({ code: 'BTC', rate: 5, effectiveDate: DAY_2 });
      expect((await helpers.storedRates({ code: 'BTC' })).at(-1)).toMatchObject({ day: TODAY, source: 'initial' });

      getRange.mockResolvedValue(
        history([
          [DAY_1, 10],
          [TODAY, 50],
        ]),
      );
      expect((await useCoingecko({ code: 'BTC', quoteCurrency: 'USD' })).statusCode).toBe(200);

      expect(await helpers.storedRates({ code: 'BTC' })).toEqual([
        { day: DAY_1, quote: 'USD', rate: 10, source: 'coingecko' },
        { day: DAY_2, quote: BASE(), rate: 5, source: 'manual' },
        { day: TODAY, quote: 'USD', rate: 50, source: 'coingecko' },
      ]);
    });

    it('keeps its day once the user edited it, which makes it manual', async () => {
      await createdToday({ code: 'BTC' });
      const account = await createAccountIn({ code: 'BTC' });
      await helpers.setUserRate({ code: 'BTC', rate: 5, effectiveDate: TODAY });

      getRange.mockResolvedValue(
        history([
          [DAY_1, 10],
          [TODAY, 50],
        ]),
      );
      expect((await useCoingecko({ code: 'BTC', quoteCurrency: BASE() })).statusCode).toBe(200);

      expect(await helpers.storedRates({ code: 'BTC' })).toEqual([
        { day: DAY_1, quote: BASE(), rate: 10, source: 'coingecko' },
        { day: TODAY, quote: BASE(), rate: 5, source: 'manual' },
      ]);
      expect((await createTx({ accountId: account.id, amount: 1, day: TODAY })).refAmount).toBe(5);
    });
  });

  describe('saving the source again', () => {
    it('keeps the stored days of the same coin when its quote changes, one rate per day', async () => {
      await createCurrency({ code: 'BTC' });
      getRange.mockResolvedValue(
        history([
          [DAY_1, 10],
          [DAY_2, 20],
        ]),
      );
      await useCoingecko({ code: 'BTC' });

      getRange.mockResolvedValue(
        history([
          [DAY_2, 7],
          [DAY_3, 8],
        ]),
      );
      expect((await useCoingecko({ code: 'BTC', quoteCurrency: BASE() })).statusCode).toBe(200);

      expect(await storedRates({ code: 'BTC' })).toEqual([
        { day: DAY_1, quote: 'USD', rate: 10, source: 'coingecko' },
        { day: DAY_2, quote: BASE(), rate: 7, source: 'coingecko' },
        { day: DAY_3, quote: BASE(), rate: 8, source: 'coingecko' },
      ]);
    });

    it("keeps another coin's days when the currency comes back to CoinGecko through another source", async () => {
      await createCurrency({ code: 'BTC' });
      getRange.mockResolvedValue(
        history([
          [DAY_1, 10],
          [DAY_2, 20],
        ]),
      );
      await useCoingecko({ code: 'BTC' });

      const manual = await helpers.setCurrencyRateSource({ code: 'BTC', payload: { rateSource: 'manual' } });
      expect(manual.statusCode).toBe(200);
      expect(await storedRates({ code: 'BTC' })).toHaveLength(2);

      getRange.mockResolvedValue(
        history([
          [DAY_2, 500],
          [DAY_3, 600],
        ]),
      );
      await useCoingecko({ code: 'BTC', coinId: 'ethereum' });

      expect(await storedRates({ code: 'BTC' })).toEqual([
        { day: DAY_1, quote: 'USD', rate: 10, source: 'coingecko' },
        { day: DAY_2, quote: 'USD', rate: 500, source: 'coingecko' },
        { day: DAY_3, quote: 'USD', rate: 600, source: 'coingecko' },
      ]);
    });
  });

  describe('a source that changes while a run is fetching', () => {
    it('does not store the rates of the coin it was fetched for', async () => {
      await createCurrency({ code: 'BTC' });
      getRange.mockResolvedValue(history([[YESTERDAY, 10]]));
      await useCoingecko({ code: 'BTC' });
      priceGet.mockImplementation(async () => {
        // The user moves the currency to another source while the sync is waiting for the coin.
        const moved = await helpers.setCurrencyRateSource({ code: 'BTC', payload: { rateSource: 'manual' } });
        expect(moved.statusCode).toBe(200);

        return { bitcoin: { usd: 50 } };
      });

      const result = await helpers.syncRateSources({ source: 'coingecko' });

      expect(result).toEqual({ coinsFetched: 1, currenciesUpdated: 0, ratesWritten: 0, failures: 0 });
      expect(await storedRates({ code: 'BTC' })).toEqual([
        { day: YESTERDAY, quote: 'USD', rate: 10, source: 'coingecko' },
      ]);
    });
  });

  describe('daily sync', () => {
    it('adds the rate of a new day without touching what was valued on earlier days', async () => {
      await createCurrency({ code: 'BTC' });
      const account = await createAccountIn({ code: 'BTC' });
      getRange.mockResolvedValue(
        history([
          [DAY_1, 10],
          [DAY_2, 20],
          [YESTERDAY, 30],
        ]),
      );
      await useCoingecko({ code: 'BTC', quoteCurrency: BASE() });

      const earlier = await createTx({ accountId: account.id, amount: 1, day: DAY_2 });
      // Today has no rate yet, so the latest earlier one prices it.
      const today = await createTx({ accountId: account.id, amount: 1, day: TODAY });
      expect(earlier.refAmount).toBe(20);
      expect(today.refAmount).toBe(30);

      priceGet.mockResolvedValue({ bitcoin: { [BASE().toLowerCase()]: 50 } });
      const result = await helpers.syncRateSources({ source: 'coingecko' });

      expect(result).toEqual({ coinsFetched: 1, currenciesUpdated: 1, ratesWritten: 1, failures: 0 });
      expect(priceGet).toHaveBeenCalledTimes(1);
      expect(priceGet).toHaveBeenCalledWith(
        expect.objectContaining({ ids: 'bitcoin', vs_currencies: BASE().toLowerCase() }),
      );
      expect(getRange).toHaveBeenCalledTimes(1);
      expect((await storedRates({ code: 'BTC' })).at(-1)).toEqual({
        day: TODAY,
        quote: BASE(),
        rate: 50,
        source: 'coingecko',
      });

      // A new rate for a new day never reaches rows that already hold an amount.
      expect((await readTx({ id: earlier.id })).refAmount).toBe(20);
      expect((await readTx({ id: today.id })).refAmount).toBe(30);
      const later = await createTx({ accountId: account.id, amount: 1, day: TODAY });
      expect(later.refAmount).toBe(50);
    });

    it('values a day again when the sync finds another price for it', async () => {
      await createCurrency({ code: 'BTC' });
      const account = await createAccountIn({ code: 'BTC' });
      getRange.mockResolvedValue(history([[YESTERDAY, 10]]));
      await useCoingecko({ code: 'BTC', quoteCurrency: BASE() });

      priceGet.mockResolvedValue({ bitcoin: { [BASE().toLowerCase()]: 50 } });
      await helpers.syncRateSources({ source: 'coingecko' });
      const tx = await createTx({ accountId: account.id, amount: 2, day: TODAY });
      expect(tx.refAmount).toBe(100);

      priceGet.mockResolvedValue({ bitcoin: { [BASE().toLowerCase()]: 60 } });
      const result = await helpers.syncRateSources({ source: 'coingecko' });

      expect(result.ratesWritten).toBe(1);
      expect((await readTx({ id: tx.id })).refAmount).toBe(120);
      expect((await storedRates({ code: 'BTC' })).filter((rate) => rate.day === TODAY)).toHaveLength(1);

      // The same price again changes nothing.
      expect((await helpers.syncRateSources({ source: 'coingecko' })).ratesWritten).toBe(0);
    });

    it('fetches a coin once for all the currencies that take it', async () => {
      await createCurrency({ code: 'BTC' });
      await createCurrency({ code: 'WBTC' });
      getRange.mockResolvedValue(history([[YESTERDAY, 10]]));
      await useCoingecko({ code: 'BTC', quoteCurrency: BASE() });
      await useCoingecko({ code: 'WBTC', quoteCurrency: BASE() });
      priceGet.mockResolvedValue({ bitcoin: { [BASE().toLowerCase()]: 70 } });

      const result = await helpers.syncRateSources({ source: 'coingecko' });

      expect(priceGet).toHaveBeenCalledTimes(1);
      expect(priceGet).toHaveBeenCalledWith(expect.objectContaining({ ids: 'bitcoin' }));
      // One coin was fetched for the two currencies that take it.
      expect(result).toEqual({ coinsFetched: 1, currenciesUpdated: 2, ratesWritten: 2, failures: 0 });
      for (const code of ['BTC', 'WBTC']) {
        expect((await storedRates({ code })).at(-1)).toEqual({
          day: TODAY,
          quote: BASE(),
          rate: 70,
          source: 'coingecko',
        });
      }
    });

    it('keeps the last rate and logs when the price call fails', async () => {
      await createCurrency({ code: 'BTC' });
      const account = await createAccountIn({ code: 'BTC' });
      getRange.mockResolvedValue(
        history([
          [DAY_1, 10],
          [YESTERDAY, 30],
        ]),
      );
      await useCoingecko({ code: 'BTC', quoteCurrency: BASE() });
      const tx = await createTx({ accountId: account.id, amount: 1, day: TODAY });
      expect(tx.refAmount).toBe(30);
      const ratesBefore = await storedRates({ code: 'BTC' });

      priceGet.mockRejectedValue(new Error('CoinGecko is down'));
      const errorSpy = jest.spyOn(logger, 'error');
      try {
        const result = await helpers.syncRateSources({ source: 'coingecko' });

        expect(result).toEqual({ coinsFetched: 0, currenciesUpdated: 0, ratesWritten: 0, failures: 1 });
        expect(errorSpy).toHaveBeenCalledWith(
          expect.objectContaining({ message: expect.stringContaining('the last rates stay in force') }),
          { code: 'COINGECKO_RATE_SYNC_FAILED' },
        );
      } finally {
        errorSpy.mockRestore();
      }

      expect(await storedRates({ code: 'BTC' })).toEqual(ratesBefore);
      expect((await readTx({ id: tx.id })).refAmount).toBe(30);
      const next = await createTx({ accountId: account.id, amount: 1, day: TODAY });
      expect(next.refAmount).toBe(30);
    });

    it('stops the run on a rate limit instead of calling on', async () => {
      await createCurrency({ code: 'BTC' });
      await createCurrency({ code: 'ETH' });
      getRange.mockResolvedValue(history([[YESTERDAY, 10]]));
      await useCoingecko({ code: 'BTC', quoteCurrency: 'USD' });
      await useCoingecko({ code: 'ETH', coinId: 'ethereum', quoteCurrency: BASE() });
      priceGet.mockRejectedValue(Object.assign(new Error('Too many requests'), { status: 429 }));

      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
      try {
        const result = await helpers.syncRateSources({ source: 'coingecko' });

        // Two quote currencies mean two batches; the second is not asked after the 429.
        expect(priceGet).toHaveBeenCalledTimes(1);
        expect(result.failures).toBe(1);
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('fills only the days a missed run left out and takes today from the batched call', async () => {
      await createCurrency({ code: 'BTC' });
      const account = await createAccountIn({ code: 'BTC' });
      getRange.mockResolvedValue(history([[DAY_1, 10]]));
      await useCoingecko({ code: 'BTC', quoteCurrency: BASE() });
      const onDay2 = await createTx({ accountId: account.id, amount: 1, day: DAY_2 });
      const onDay3 = await createTx({ accountId: account.id, amount: 1, day: DAY_3 });
      expect(onDay2.refAmount).toBe(10);
      expect(onDay3.refAmount).toBe(10);

      // At 00:30 UTC the history has no point for today, and prices a stored day a little differently.
      getRange.mockResolvedValue(
        history([
          [DAY_1, 15],
          [DAY_3, 30],
          [YESTERDAY, 40],
        ]),
      );
      priceGet.mockResolvedValue({ bitcoin: { [BASE().toLowerCase()]: 50 } });
      const result = await helpers.syncRateSources({ source: 'coingecko' });

      expect(result).toEqual({ coinsFetched: 1, currenciesUpdated: 1, ratesWritten: 3, failures: 0 });
      expect(getRange).toHaveBeenCalledTimes(2);
      expect(priceGet).toHaveBeenCalledTimes(1);
      expect((await storedRates({ code: 'BTC' })).map(({ day, rate }) => [day, rate])).toEqual([
        [DAY_1, 10],
        [DAY_3, 30],
        [YESTERDAY, 40],
        [TODAY, 50],
      ]);
      expect((await readTx({ id: onDay2.id })).refAmount).toBe(10);
      expect((await readTx({ id: onDay3.id })).refAmount).toBe(30);

      await helpers.syncRateSources({ source: 'coingecko' });
      expect(getRange).toHaveBeenCalledTimes(2);
      expect(priceGet).toHaveBeenCalledTimes(2);
    });

    it('stores the batched prices when a history call hits the rate limit, and retries the gap next run', async () => {
      await createCurrency({ code: 'BTC' });
      await createCurrency({ code: 'ETH' });
      getRange.mockResolvedValueOnce(history([[DAY_1, 10]]));
      await useCoingecko({ code: 'BTC', quoteCurrency: BASE() });
      getRange.mockResolvedValueOnce(history([[YESTERDAY, 4]]));
      await useCoingecko({ code: 'ETH', coinId: 'ethereum', quoteCurrency: BASE() });
      getRange.mockRejectedValueOnce(Object.assign(new Error('Too many requests'), { status: 429 }));
      priceGet.mockResolvedValue({
        bitcoin: { [BASE().toLowerCase()]: 50 },
        ethereum: { [BASE().toLowerCase()]: 5 },
      });

      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
      try {
        const result = await helpers.syncRateSources({ source: 'coingecko' });

        expect(result).toEqual({ coinsFetched: 2, currenciesUpdated: 1, ratesWritten: 1, failures: 1 });
        expect(priceGet).toHaveBeenCalledTimes(1);
        expect(getRange).toHaveBeenCalledTimes(3);
      } finally {
        errorSpy.mockRestore();
      }
      expect((await storedRates({ code: 'ETH' })).at(-1)).toEqual({
        day: TODAY,
        quote: BASE(),
        rate: 5,
        source: 'coingecko',
      });
      // BTC stores today only with its gap, so it stays behind for the next run.
      expect((await storedRates({ code: 'BTC' })).map(({ day }) => day)).toEqual([DAY_1]);

      getRange.mockResolvedValue(
        history([
          [DAY_1, 10],
          [DAY_3, 30],
        ]),
      );
      await helpers.syncRateSources({ source: 'coingecko' });

      expect(getRange).toHaveBeenCalledTimes(4);
      expect((await storedRates({ code: 'BTC' })).map(({ day, rate }) => [day, rate])).toEqual([
        [DAY_1, 10],
        [DAY_3, 30],
        [TODAY, 50],
      ]);
    });

    it('does not fetch the history of a coin that has no price today', async () => {
      await createCurrency({ code: 'BTC' });
      getRange.mockResolvedValue(history([[DAY_1, 10]]));
      await useCoingecko({ code: 'BTC', quoteCurrency: BASE() });
      priceGet.mockResolvedValue({});

      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
      try {
        expect(await helpers.syncRateSources({ source: 'coingecko' })).toEqual({
          coinsFetched: 1,
          currenciesUpdated: 0,
          ratesWritten: 0,
          failures: 1,
        });
      } finally {
        warnSpy.mockRestore();
      }
      expect(getRange).toHaveBeenCalledTimes(1);
    });

    it('does nothing when no currency uses CoinGecko', async () => {
      await createCurrency({ code: 'BTC' });

      expect(await helpers.syncRateSources({ source: 'coingecko' })).toEqual({
        coinsFetched: 0,
        currenciesUpdated: 0,
        ratesWritten: 0,
        failures: 0,
      });
      expect(getRange).not.toHaveBeenCalled();
      expect(priceGet).not.toHaveBeenCalled();
    });
  });

  describe('changing the base currency', () => {
    it('crosses the stored quote into the new base without fetching again', async () => {
      await createCurrency({ code: 'BTC' });
      const account = await createAccountIn({ code: 'BTC' });
      getRange.mockResolvedValue(
        history([
          [DAY_1, 10],
          [DAY_2, 20],
          [DAY_3, 30],
        ]),
      );
      await useCoingecko({ code: 'BTC' });
      const tx = await createTx({ accountId: account.id, amount: 0.5, day: DAY_2 });
      expect(tx.refAmount).toBe(0.5 * 20 * AED_PER_USD);
      const ratesBefore = await storedRates({ code: 'BTC' });
      getRange.mockClear();
      priceGet.mockClear();

      const status = await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: NEW_BASE });
      helpers.expectBaseCurrencyChangeCompleted(status);

      const after = await readTx({ id: tx.id });
      expect(after.refCurrencyCode).toBe(NEW_BASE);
      expect(after.refAmount).toBe(0.5 * 20 * EUR_PER_USD);
      expect(getRange).not.toHaveBeenCalled();
      expect(priceGet).not.toHaveBeenCalled();
      expect(await storedRates({ code: 'BTC' })).toEqual(ratesBefore);

      const next = await createTx({ accountId: account.id, amount: 1, day: DAY_3 });
      expect(next.refAmount).toBe(30 * EUR_PER_USD);
    }, 60000);
  });
});
