import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type AnyFn = (...args: unknown[]) => Promise<unknown>;

jest.mock('@models/user-exchange-rates.model', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findAll: jest.fn() },
  toEffectiveDate: ({ date }: { date: Date }) => date.toISOString().slice(0, 10),
}));
jest.mock('@models/users-currencies.model', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('@services/currencies/custom-currency-codes', () => ({ findCustomCurrencyCodes: jest.fn() }));
jest.mock('@i18n/index', () => ({ t: ({ key }: { key: string }) => key }));

/* eslint-disable import/first */
import { ExchangeRateUnavailableError, UnexpectedError } from '@js/errors';
import UserExchangeRates from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';
import { findCustomCurrencyCodes } from '@services/currencies/custom-currency-codes';
import Big from 'big.js';
import { Op } from 'sequelize';

import { loadCustomCurrencyDailyQuote, resolveCustomPairRate } from './resolve-custom-pair-rate';
/* eslint-enable import/first */

const findRate = UserExchangeRates.findOne as unknown as jest.Mock<AnyFn>;
const findRates = UserExchangeRates.findAll as unknown as jest.Mock<AnyFn>;
const findHeldCurrency = UsersCurrencies.findOne as unknown as jest.Mock<AnyFn>;
const findCustom = findCustomCurrencyCodes as unknown as jest.Mock<AnyFn>;

const DATE = new Date('2026-10-17T00:00:00.000Z');
const CUSTOM_CODES = new Set(['SAT', 'USDT', 'USDC', 'BTC', 'COIN']);
const LONG_AGO = '2000-01-01';

interface StoredRate {
  baseCode: string;
  quoteCode: string;
  rate: number;
  effectiveDate: string;
}

/**
 * Stored user rates. A plain `base>quote` key holds one rate in force since long ago; `dated` adds
 * rates that start on a given day. The mock follows the real queries: a lookup by base alone matches
 * any quote, `effectiveDate <= day` takes the latest first, and without a day the earliest comes first.
 */
const storeRates = (rates: Record<string, number>, dated: StoredRate[] = []) => {
  const rows: StoredRate[] = [
    ...Object.entries(rates).map(([key, rate]) => {
      const [baseCode, quoteCode] = key.split('>') as [string, string];
      return { baseCode, quoteCode, rate, effectiveDate: LONG_AGO };
    }),
    ...dated,
  ];

  findRate.mockImplementation(async (options) => {
    const { where, order } = options as {
      where: { baseCode: string; quoteCode?: string; effectiveDate?: { [Op.lte]: string } };
      order: [string, string][];
    };
    const asOf = where.effectiveDate?.[Op.lte];
    const earliestFirst = order[0]![1] === 'ASC';
    const [first] = rows
      .filter(
        (row) =>
          row.baseCode === where.baseCode &&
          (where.quoteCode === undefined || row.quoteCode === where.quoteCode) &&
          (asOf === undefined || row.effectiveDate <= asOf),
      )
      .toSorted((a, b) =>
        earliestFirst ? a.effectiveDate.localeCompare(b.effectiveDate) : b.effectiveDate.localeCompare(a.effectiveDate),
      );
    return first ?? null;
  });
};

/** The currencies the user keeps on a rate source other than their own stored rates. */
const setSources = (sources: Record<string, { rateSource: string; rateSourceConfig: unknown }>) => {
  findHeldCurrency.mockImplementation(async (options) => {
    const { where } = options as { where: { currencyCode: string } };

    return sources[where.currencyCode] ?? { rateSource: 'manual', rateSourceConfig: null };
  });
};

const peg = ({ pegCurrency, factor }: { pegCurrency: string; factor: number }) => ({
  rateSource: 'peg',
  rateSourceConfig: { pegCurrency, factor },
});

const datedRate = ({
  baseCode,
  quoteCode,
  value,
  effectiveDate,
}: {
  baseCode: string;
  quoteCode: string;
  value: number;
  effectiveDate: string;
}): StoredRate => ({ baseCode, quoteCode, rate: value, effectiveDate });

const isoRates = (rates: Record<string, number>) =>
  jest.fn(async ({ baseCode, quoteCode }: { baseCode: string; quoteCode: string }) => {
    const rate = rates[`${baseCode}>${quoteCode}`];
    if (rate === undefined) throw new ExchangeRateUnavailableError({ message: 'no market rate' });
    return { baseCode, quoteCode, date: DATE, rate };
  });

const resolvePair = ({
  baseCode,
  quoteCode,
  resolveIsoRate = isoRates({}),
  date = DATE,
}: {
  baseCode: string;
  quoteCode: string;
  resolveIsoRate?: ReturnType<typeof isoRates>;
  date?: Date;
}) => resolveCustomPairRate({ userId: 1, pair: { baseCode, quoteCode }, date, resolveIsoRate });

const onDay = (day: string) => new Date(`${day}T15:30:00.000Z`);

describe('resolveCustomPairRate', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    findCustom.mockImplementation(
      async (options) => new Set((options as { codes: string[] }).codes.filter((code) => CUSTOM_CODES.has(code))),
    );
    setSources({});
  });

  it('uses the stored rate of the custom currency in its own quote, with its full precision', async () => {
    storeRates({ 'SAT>USD': 0.00067123456789 });
    const resolveIsoRate = isoRates({});

    const result = await resolvePair({ baseCode: 'SAT', quoteCode: 'USD', resolveIsoRate });

    expect(result).toMatchObject({ baseCode: 'SAT', quoteCode: 'USD', rate: 0.00067123456789, custom: true });
    expect(resolveIsoRate).not.toHaveBeenCalled();
  });

  it('crosses the stored ISO quote into the target with the ISO resolution', async () => {
    storeRates({ 'USDT>USD': 1 });
    const resolveIsoRate = isoRates({ 'USD>EUR': 0.95 });

    const result = await resolvePair({ baseCode: 'USDT', quoteCode: 'EUR', resolveIsoRate });

    expect(result.rate).toBe(0.95);
    expect(resolveIsoRate).toHaveBeenCalledWith({ baseCode: 'USD', quoteCode: 'EUR' });
  });

  it('prices a custom target through its own stored quote', async () => {
    storeRates({ 'BTC>USD': 50000 });

    const result = await resolvePair({
      baseCode: 'EUR',
      quoteCode: 'BTC',
      resolveIsoRate: isoRates({ 'EUR>USD': 1.1 }),
    });

    expect(result.rate).toBeCloseTo(1.1 / 50000, 15);
  });

  it('prices an ISO-to-custom pair as the inverse of the stored rate, never reading a stored inverse row', async () => {
    storeRates({ 'SAT>USD': 4, 'USD>SAT': 0.3 });

    expect((await resolvePair({ baseCode: 'USD', quoteCode: 'SAT' })).rate).toBe(0.25);
  });

  it('answers with no ISO conversion when both sides are quoted in the same ISO currency', async () => {
    storeRates({ 'USDT>USD': 1, 'USDC>USD': 1 });
    const resolveIsoRate = isoRates({});

    const result = await resolvePair({ baseCode: 'USDT', quoteCode: 'USDC', resolveIsoRate });

    expect(result.rate).toBe(1);
    expect(resolveIsoRate).not.toHaveBeenCalled();
  });

  it('is unavailable when the user has no rate for the custom currency', async () => {
    storeRates({});

    await expect(resolvePair({ baseCode: 'SAT', quoteCode: 'USD' })).rejects.toBeInstanceOf(
      ExchangeRateUnavailableError,
    );
  });

  it('is unavailable, and never reaches the ISO resolution, for a stored rate quoted in a custom code', async () => {
    storeRates({ 'SAT>COIN': 2, 'COIN>USD': 10 });
    const resolveIsoRate = isoRates({});

    await expect(resolvePair({ baseCode: 'SAT', quoteCode: 'EUR', resolveIsoRate })).rejects.toBeInstanceOf(
      ExchangeRateUnavailableError,
    );
    expect(resolveIsoRate).not.toHaveBeenCalled();
  });

  it('passes through the failure of the ISO leg', async () => {
    storeRates({ 'USDT>USD': 1 });

    await expect(resolvePair({ baseCode: 'USDT', quoteCode: 'JPY' })).rejects.toBeInstanceOf(
      ExchangeRateUnavailableError,
    );
  });

  describe('by day', () => {
    it('takes the rate that started most recently on or before the day', async () => {
      storeRates({}, [
        datedRate({ baseCode: 'USDT', quoteCode: 'USD', value: 1, effectiveDate: '2026-01-01' }),
        datedRate({ baseCode: 'USDT', quoteCode: 'USD', value: 2, effectiveDate: '2026-03-01' }),
        datedRate({ baseCode: 'USDT', quoteCode: 'USD', value: 3, effectiveDate: '2026-06-01' }),
      ]);
      const resolve = (day: string) => resolvePair({ baseCode: 'USDT', quoteCode: 'USD', date: onDay(day) });

      expect((await resolve('2026-01-01')).rate).toBe(1);
      expect((await resolve('2026-02-28')).rate).toBe(1);
      expect((await resolve('2026-03-01')).rate).toBe(2);
      expect((await resolve('2026-09-09')).rate).toBe(3);
    });

    it('takes the earliest rate on a day before the first one', async () => {
      storeRates({}, [
        datedRate({ baseCode: 'USDT', quoteCode: 'USD', value: 1.5, effectiveDate: '2026-03-01' }),
        datedRate({ baseCode: 'USDT', quoteCode: 'USD', value: 2, effectiveDate: '2026-06-01' }),
      ]);
      const resolveIsoRate = isoRates({ 'USD>EUR': 0.5 });

      const longBefore = onDay('2020-01-01');

      expect((await resolvePair({ baseCode: 'USDT', quoteCode: 'USD', date: onDay('2026-02-28') })).rate).toBe(1.5);
      expect((await resolvePair({ baseCode: 'USDT', quoteCode: 'EUR', resolveIsoRate, date: longBefore })).rate).toBe(
        0.75,
      );
      expect(
        (
          await resolvePair({
            baseCode: 'EUR',
            quoteCode: 'USDT',
            resolveIsoRate: isoRates({ 'EUR>USD': 3 }),
            date: longBefore,
          })
        ).rate,
      ).toBe(2);
    });

    it('switches the stored quote on the day the user starts quoting in another currency', async () => {
      storeRates({}, [
        datedRate({ baseCode: 'USDT', quoteCode: 'USD', value: 1, effectiveDate: '2026-01-01' }),
        datedRate({ baseCode: 'USDT', quoteCode: 'EUR', value: 0.9, effectiveDate: '2026-04-01' }),
      ]);
      const resolveIsoRate = isoRates({ 'USD>GBP': 0.8, 'EUR>GBP': 0.85 });
      const resolve = (day: string) =>
        resolvePair({ baseCode: 'USDT', quoteCode: 'GBP', resolveIsoRate, date: onDay(day) });

      expect((await resolve('2026-03-31')).rate).toBe(0.8);
      expect((await resolve('2026-04-01')).rate).toBeCloseTo(0.9 * 0.85, 12);
    });

    it('keeps a rate of a thousandth of a cent whole, so a million units convert to exactly one', async () => {
      storeRates({ 'SAT>USD': 0.000001 });

      const result = await resolvePair({ baseCode: 'SAT', quoteCode: 'USD' });

      expect(result.rate).toBe(0.000001);
      expect(new Big(1_000_000).times(result.rate).toNumber()).toBe(1);
    });
  });

  describe('whatever the rate source', () => {
    it.each(['manual', 'coingecko', 'http'])(
      'values a %s currency by its latest rate on or before the day, in whichever quote it is stored',
      async (rateSource) => {
        storeRates({}, [
          datedRate({ baseCode: 'SAT', quoteCode: 'EUR', value: 2, effectiveDate: '2026-01-01' }),
          datedRate({ baseCode: 'SAT', quoteCode: 'USD', value: 10, effectiveDate: '2026-10-10' }),
        ]);
        setSources({ SAT: { rateSource, rateSourceConfig: {} } });

        const result = await resolvePair({
          baseCode: 'SAT',
          quoteCode: 'EUR',
          resolveIsoRate: isoRates({ 'USD>EUR': 0.5 }),
        });

        expect(result.rate).toBe(5);
      },
    );
  });

  describe('a pegged currency', () => {
    it('is worth the factor times its peg currency, with no stored rate and no ISO lookup for the same currency', async () => {
      storeRates({});
      setSources({ USDT: peg({ pegCurrency: 'USD', factor: 1 }) });
      const resolveIsoRate = isoRates({});

      const result = await resolvePair({ baseCode: 'USDT', quoteCode: 'USD', resolveIsoRate });

      expect(result).toMatchObject({ baseCode: 'USDT', quoteCode: 'USD', rate: 1, custom: true });
      expect(resolveIsoRate).not.toHaveBeenCalled();
    });

    it('crosses the peg currency into the target with the ISO resolution of the same day', async () => {
      storeRates({});
      setSources({ USDT: peg({ pegCurrency: 'USD', factor: 1.02 }) });
      const resolveIsoRate = isoRates({ 'USD>EUR': 0.9 });

      const result = await resolvePair({ baseCode: 'USDT', quoteCode: 'EUR', resolveIsoRate });

      expect(result.rate).toBeCloseTo(1.02 * 0.9, 12);
      expect(resolveIsoRate).toHaveBeenCalledWith({ baseCode: 'USD', quoteCode: 'EUR' });
    });

    it('prices a pegged target by dividing, so the two directions are exact inverses', async () => {
      storeRates({});
      setSources({ USDT: peg({ pegCurrency: 'USD', factor: 4 }) });

      expect((await resolvePair({ baseCode: 'USD', quoteCode: 'USDT' })).rate).toBe(0.25);
    });

    it('ignores rows stored for the currency before it was pegged', async () => {
      storeRates({ 'USDT>USD': 7, 'USD>USDT': 0.14 });
      setSources({ USDT: peg({ pegCurrency: 'USD', factor: 1 }) });

      expect((await resolvePair({ baseCode: 'USDT', quoteCode: 'USD' })).rate).toBe(1);
      expect((await resolvePair({ baseCode: 'USD', quoteCode: 'USDT' })).rate).toBe(1);
    });

    it.each([
      ['a peg onto a custom code', { pegCurrency: 'USDT', factor: 1 }],
      ['a missing config', null],
      ['a config of the wrong shape', { pegCurrency: 'USD' }],
      ['a zero factor', { pegCurrency: 'USD', factor: 0 }],
      ['a string factor', { pegCurrency: 'USD', factor: '1' }],
      ['a config that is not an object', 'USD'],
    ])('throws a data error, not a guess, for a peg saved with %s', async (_name, rateSourceConfig) => {
      storeRates({ 'USDT>USD': 5 });
      setSources({ USDT: { rateSource: 'peg', rateSourceConfig } });

      await expect(resolvePair({ baseCode: 'USDT', quoteCode: 'USD' })).rejects.toBeInstanceOf(UnexpectedError);
    });

    it('leaves a currency on manual rates alone when another one is pegged', async () => {
      storeRates({ 'SAT>USD': 0.001 });
      setSources({ USDT: peg({ pegCurrency: 'USD', factor: 1 }) });

      expect((await resolvePair({ baseCode: 'SAT', quoteCode: 'USD' })).rate).toBe(0.001);
    });
  });

  describe('loadCustomCurrencyDailyQuote', () => {
    const load = ({ code }: { code: string }) => loadCustomCurrencyDailyQuote({ userId: 1, code });

    it('gives each day the rate in force in any quote, and a day before the first the earliest', async () => {
      findRates.mockResolvedValue([
        datedRate({ baseCode: 'USDT', quoteCode: 'EUR', value: 9, effectiveDate: '2025-01-01' }),
        datedRate({ baseCode: 'USDT', quoteCode: 'USD', value: 1, effectiveDate: '2026-01-01' }),
        datedRate({ baseCode: 'USDT', quoteCode: 'USD', value: 2, effectiveDate: '2026-03-01' }),
      ]);

      const quote = await load({ code: 'USDT' });

      expect(quote!.quoteCodes).toEqual(['EUR', 'USD']);
      expect(['2020-01-01', '2025-06-01', '2026-02-28', '2026-03-01'].map((day) => quote!.quoteOn(day))).toEqual([
        { quoteCode: 'EUR', rate: 9 },
        { quoteCode: 'EUR', rate: 9 },
        { quoteCode: 'USD', rate: 1 },
        { quoteCode: 'USD', rate: 2 },
      ]);
    });

    it.each(['manual', 'coingecko', 'http'])(
      'values every day as resolveCustomPairRate does, for a currency on %s rates kept in two quotes',
      async (rateSource) => {
        const rows = [
          datedRate({ baseCode: 'SAT', quoteCode: 'EUR', value: 2, effectiveDate: '2025-01-01' }),
          datedRate({ baseCode: 'SAT', quoteCode: 'USD', value: 10, effectiveDate: '2025-11-22' }),
          datedRate({ baseCode: 'SAT', quoteCode: 'USD', value: 12, effectiveDate: '2026-06-01' }),
        ];
        storeRates({}, rows);
        findRates.mockResolvedValue(rows);
        setSources({ SAT: { rateSource, rateSourceConfig: {} } });
        const usdToEur = 0.5;

        const quote = await load({ code: 'SAT' });

        for (const day of ['2024-01-01', '2025-06-01', '2025-12-01', '2026-07-01']) {
          const resolved = await resolvePair({
            baseCode: 'SAT',
            quoteCode: 'EUR',
            resolveIsoRate: isoRates({ 'USD>EUR': usdToEur }),
            date: onDay(day),
          });
          const { quoteCode, rate } = quote!.quoteOn(day)!;

          expect(rate * (quoteCode === 'EUR' ? 1 : usdToEur)).toBe(resolved.rate);
        }
      },
    );

    it('has no rate for a day whose stored rate is quoted in a custom code', async () => {
      findRates.mockResolvedValue([
        datedRate({ baseCode: 'SAT', quoteCode: 'COIN', value: 2, effectiveDate: LONG_AGO }),
      ]);

      const quote = await load({ code: 'SAT' });

      expect(quote!.quoteCodes).toEqual([]);
      expect(quote!.quoteOn('2026-01-01')).toBeNull();
    });

    it('takes the factor of a peg on every day, and has nothing for a currency with no rate', async () => {
      setSources({ USDT: peg({ pegCurrency: 'USD', factor: 1.5 }) });
      const pegged = await load({ code: 'USDT' });
      expect(pegged!.quoteCodes).toEqual(['USD']);
      expect(pegged!.quoteOn('2020-01-01')).toEqual({ quoteCode: 'USD', rate: 1.5 });

      findRates.mockResolvedValue([]);
      expect(await load({ code: 'SAT' })).toBeNull();
    });
  });
});
