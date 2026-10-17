import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type AnyFn = (...args: unknown[]) => Promise<unknown>;

jest.mock('@models/user-exchange-rates.model', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
  toEffectiveDate: ({ date }: { date: Date }) => date.toISOString().slice(0, 10),
}));
jest.mock('@models/users-currencies.model', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('@i18n/index', () => ({ t: ({ key }: { key: string }) => key }));

/* eslint-disable import/first */
import { ExchangeRateUnavailableError } from '@js/errors';
import UserExchangeRates from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';
import Big from 'big.js';
import { Op } from 'sequelize';

import { resolveCustomPairRate } from './resolve-custom-pair-rate';
/* eslint-enable import/first */

const findRate = UserExchangeRates.findOne as unknown as jest.Mock<AnyFn>;

const findHeldCurrency = UsersCurrencies.findOne as unknown as jest.Mock<AnyFn>;

const DATE = new Date('2026-10-17T00:00:00.000Z');

interface StoredRate {
  baseCode: string;
  quoteCode: string;
  rate: number;
  effectiveDate: string;
}

const LONG_AGO = '2000-01-01';

/**
 * Stored user rates. A plain `base>quote` key holds one rate in force since long ago; `dated` adds
 * rates that start on a given day. A lookup by base alone matches any quote, and the latest rate
 * on or before the asked day comes back first, as the real query orders them.
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
    const { where } = options as {
      where: {
        baseCode: string;
        quoteCode?: string | { [Op.notIn]: string[] };
        effectiveDate: { [Op.lte]: string };
      };
    };
    const exactQuote = typeof where.quoteCode === 'string' ? where.quoteCode : undefined;
    const excludedQuotes = typeof where.quoteCode === 'object' ? where.quoteCode[Op.notIn] : [];
    const asOf = where.effectiveDate[Op.lte];
    const [latest] = rows
      .filter(
        (row) =>
          row.baseCode === where.baseCode &&
          (exactQuote === undefined || row.quoteCode === exactQuote) &&
          !excludedQuotes.includes(row.quoteCode) &&
          row.effectiveDate <= asOf,
      )
      .toSorted((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
    return latest ?? null;
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

const isCustomIn =
  (codes: string[]) =>
  async ({ code }: { code: string }) =>
    codes.includes(code);

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

describe('resolveCustomPairRate', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('uses the rate the user entered for exactly this pair, with its full precision', async () => {
    storeRates({ 'SAT>USD': 0.00067123456789 });
    const resolveIsoRate = isoRates({});

    const result = await resolveCustomPairRate({
      userId: 1,
      pair: { baseCode: 'SAT', quoteCode: 'USD' },
      date: DATE,
      isCustom: isCustomIn(['SAT']),
      resolveIsoRate,
    });

    expect(result).toMatchObject({ baseCode: 'SAT', quoteCode: 'USD', rate: 0.00067123456789, custom: true });
    expect(resolveIsoRate).not.toHaveBeenCalled();
  });

  it('crosses the stored quote into the target with the ISO resolution', async () => {
    storeRates({ 'USDT>USD': 1 });
    const resolveIsoRate = isoRates({ 'USD>EUR': 0.95 });

    const result = await resolveCustomPairRate({
      userId: 1,
      pair: { baseCode: 'USDT', quoteCode: 'EUR' },
      date: DATE,
      isCustom: isCustomIn(['USDT']),
      resolveIsoRate,
    });

    expect(result.rate).toBe(0.95);
    expect(resolveIsoRate).toHaveBeenCalledWith({ baseCode: 'USD', quoteCode: 'EUR' });
  });

  it('prices a custom target through its own stored quote', async () => {
    storeRates({ 'BTC>USD': 50000 });

    const result = await resolveCustomPairRate({
      userId: 1,
      pair: { baseCode: 'EUR', quoteCode: 'BTC' },
      date: DATE,
      isCustom: isCustomIn(['BTC']),
      resolveIsoRate: isoRates({ 'EUR>USD': 1.1 }),
    });

    expect(result.rate).toBeCloseTo(1.1 / 50000, 15);
  });

  it('follows a chain of custom currencies down to an ISO one', async () => {
    storeRates({ 'USDC>USDT': 1, 'USDT>USD': 0.999 });

    const result = await resolveCustomPairRate({
      userId: 1,
      pair: { baseCode: 'USDC', quoteCode: 'EUR' },
      date: DATE,
      isCustom: isCustomIn(['USDC', 'USDT']),
      resolveIsoRate: isoRates({ 'USD>EUR': 0.9 }),
    });

    expect(result.rate).toBeCloseTo(0.8991, 12);
  });

  it('answers with no conversion when both sides land on the same ISO currency', async () => {
    storeRates({ 'USDT>USD': 1, 'USDC>USD': 1 });
    const resolveIsoRate = isoRates({});

    const result = await resolveCustomPairRate({
      userId: 1,
      pair: { baseCode: 'USDT', quoteCode: 'USDC' },
      date: DATE,
      isCustom: isCustomIn(['USDT', 'USDC']),
      resolveIsoRate,
    });

    expect(result.rate).toBe(1);
    expect(resolveIsoRate).not.toHaveBeenCalled();
  });

  it('is unavailable when the user has no rate for the custom currency', async () => {
    storeRates({});

    await expect(
      resolveCustomPairRate({
        userId: 1,
        pair: { baseCode: 'SAT', quoteCode: 'USD' },
        date: DATE,
        isCustom: isCustomIn(['SAT']),
        resolveIsoRate: isoRates({}),
      }),
    ).rejects.toBeInstanceOf(ExchangeRateUnavailableError);
  });

  it('is unavailable for a loop of custom currencies instead of walking it forever', async () => {
    storeRates({ 'AAA>BBB': 1, 'BBB>AAA': 1 });

    await expect(
      resolveCustomPairRate({
        userId: 1,
        pair: { baseCode: 'AAA', quoteCode: 'USD' },
        date: DATE,
        isCustom: isCustomIn(['AAA', 'BBB']),
        resolveIsoRate: isoRates({}),
      }),
    ).rejects.toBeInstanceOf(ExchangeRateUnavailableError);
  });

  it('passes through the failure of the ISO leg', async () => {
    storeRates({ 'USDT>USD': 1 });

    await expect(
      resolveCustomPairRate({
        userId: 1,
        pair: { baseCode: 'USDT', quoteCode: 'JPY' },
        date: DATE,
        isCustom: isCustomIn(['USDT']),
        resolveIsoRate: isoRates({}),
      }),
    ).rejects.toBeInstanceOf(ExchangeRateUnavailableError);
  });

  describe('by day', () => {
    it('takes the rate that started most recently on or before the day', async () => {
      storeRates({}, [
        datedRate({ baseCode: 'USDT', quoteCode: 'USD', value: 1, effectiveDate: '2026-01-01' }),
        datedRate({ baseCode: 'USDT', quoteCode: 'USD', value: 2, effectiveDate: '2026-03-01' }),
        datedRate({ baseCode: 'USDT', quoteCode: 'USD', value: 3, effectiveDate: '2026-06-01' }),
      ]);
      const resolve = (day: string) =>
        resolveCustomPairRate({
          userId: 1,
          pair: { baseCode: 'USDT', quoteCode: 'USD' },
          date: new Date(`${day}T15:30:00.000Z`),
          isCustom: isCustomIn(['USDT']),
          resolveIsoRate: isoRates({}),
        });

      expect((await resolve('2026-01-01')).rate).toBe(1);
      expect((await resolve('2026-02-28')).rate).toBe(1);
      expect((await resolve('2026-03-01')).rate).toBe(2);
      expect((await resolve('2026-09-09')).rate).toBe(3);
    });

    it('reports the day a rate started as the date it applies from', async () => {
      storeRates({}, [datedRate({ baseCode: 'USDT', quoteCode: 'USD', value: 1, effectiveDate: '2026-03-01' })]);

      const result = await resolveCustomPairRate({
        userId: 1,
        pair: { baseCode: 'USDT', quoteCode: 'USD' },
        date: new Date('2026-05-05T00:00:00.000Z'),
        isCustom: isCustomIn(['USDT']),
        resolveIsoRate: isoRates({}),
      });

      expect(result.date).toEqual(new Date('2026-03-01T00:00:00.000Z'));
    });

    it('is unavailable on a day before the first rate', async () => {
      storeRates({}, [datedRate({ baseCode: 'USDT', quoteCode: 'USD', value: 1, effectiveDate: '2026-03-01' })]);

      await expect(
        resolveCustomPairRate({
          userId: 1,
          pair: { baseCode: 'USDT', quoteCode: 'USD' },
          date: new Date('2026-02-28T23:59:59.000Z'),
          isCustom: isCustomIn(['USDT']),
          resolveIsoRate: isoRates({}),
        }),
      ).rejects.toBeInstanceOf(ExchangeRateUnavailableError);
    });

    it('switches the stored quote on the day the user starts quoting in another currency', async () => {
      storeRates({}, [
        datedRate({ baseCode: 'USDT', quoteCode: 'USD', value: 1, effectiveDate: '2026-01-01' }),
        datedRate({ baseCode: 'USDT', quoteCode: 'EUR', value: 0.9, effectiveDate: '2026-04-01' }),
      ]);
      const resolveIsoRate = isoRates({ 'USD>GBP': 0.8, 'EUR>GBP': 0.85 });
      const resolve = (day: string) =>
        resolveCustomPairRate({
          userId: 1,
          pair: { baseCode: 'USDT', quoteCode: 'GBP' },
          date: new Date(`${day}T00:00:00.000Z`),
          isCustom: isCustomIn(['USDT']),
          resolveIsoRate,
        });

      expect((await resolve('2026-03-31')).rate).toBe(0.8);
      expect((await resolve('2026-04-01')).rate).toBeCloseTo(0.9 * 0.85, 12);
    });

    it('prefers a rate entered for exactly the pair on that day over crossing the stored quote', async () => {
      storeRates({}, [
        datedRate({ baseCode: 'USDT', quoteCode: 'USD', value: 1, effectiveDate: '2026-01-01' }),
        datedRate({ baseCode: 'USDT', quoteCode: 'EUR', value: 0.93, effectiveDate: '2026-02-01' }),
      ]);
      const resolveIsoRate = isoRates({ 'USD>EUR': 0.9 });
      const resolve = (day: string) =>
        resolveCustomPairRate({
          userId: 1,
          pair: { baseCode: 'USDT', quoteCode: 'EUR' },
          date: new Date(`${day}T00:00:00.000Z`),
          isCustom: isCustomIn(['USDT']),
          resolveIsoRate,
        });

      expect((await resolve('2026-01-15')).rate).toBe(0.9);
      expect((await resolve('2026-02-15')).rate).toBe(0.93);
    });

    it('keeps a rate of a thousandth of a cent whole, so a million units convert to exactly one', async () => {
      storeRates({ 'SAT>USD': 0.000001 });

      const result = await resolveCustomPairRate({
        userId: 1,
        pair: { baseCode: 'SAT', quoteCode: 'USD' },
        date: DATE,
        isCustom: isCustomIn(['SAT']),
        resolveIsoRate: isoRates({}),
      });

      expect(result.rate).toBe(0.000001);
      expect(new Big(1_000_000).times(result.rate).toNumber()).toBe(1);
    });
  });

  describe('a rate quoted in another custom currency', () => {
    it('is unavailable, and never reaches the ISO resolution, when the rates only lead back to where they started', async () => {
      storeRates({ 'SAT>COIN': 2, 'COIN>SAT': 0.5 });
      const resolveIsoRate = isoRates({});

      await expect(
        resolveCustomPairRate({
          userId: 1,
          pair: { baseCode: 'SAT', quoteCode: 'EUR' },
          date: DATE,
          isCustom: isCustomIn(['SAT', 'COIN']),
          resolveIsoRate,
        }),
      ).rejects.toBeInstanceOf(ExchangeRateUnavailableError);
      expect(resolveIsoRate).not.toHaveBeenCalled();
    });

    it('walks on past the reverse rate the editor stores beside every pair', async () => {
      // The reverse of SAT>COIN is COIN>SAT, written after COIN>USD: it must not win.
      storeRates({ 'SAT>COIN': 2, 'COIN>USD': 10, 'COIN>SAT': 0.5 });
      const resolveIsoRate = isoRates({ 'USD>EUR': 0.9 });

      const result = await resolveCustomPairRate({
        userId: 1,
        pair: { baseCode: 'SAT', quoteCode: 'EUR' },
        date: DATE,
        isCustom: isCustomIn(['SAT', 'COIN']),
        resolveIsoRate,
      });

      expect(result.rate).toBeCloseTo(2 * 10 * 0.9, 12);
      expect(resolveIsoRate).toHaveBeenCalledWith({ baseCode: 'USD', quoteCode: 'EUR' });
    });
  });

  describe('a currency on a synced source', () => {
    it.each(['coingecko', 'http'])(
      'is valued by the %s rates alone, not by a rate quoted in the base entered earlier',
      async (rateSource) => {
        // A manual SAT/EUR rate from before the switch, and the source's own SAT/USD rows since.
        storeRates({}, [
          datedRate({ baseCode: 'SAT', quoteCode: 'EUR', value: 2, effectiveDate: '2026-01-01' }),
          datedRate({ baseCode: 'SAT', quoteCode: 'USD', value: 10, effectiveDate: '2026-10-10' }),
        ]);
        setSources({ SAT: { rateSource, rateSourceConfig: {} } });

        const result = await resolveCustomPairRate({
          userId: 1,
          pair: { baseCode: 'SAT', quoteCode: 'EUR' },
          date: DATE,
          isCustom: isCustomIn(['SAT']),
          resolveIsoRate: isoRates({ 'USD>EUR': 0.5 }),
        });

        expect(result.rate).toBe(5);
      },
    );

    it('still takes the exact pair rate of a currency on manual rates', async () => {
      storeRates({}, [
        datedRate({ baseCode: 'SAT', quoteCode: 'EUR', value: 2, effectiveDate: '2026-01-01' }),
        datedRate({ baseCode: 'SAT', quoteCode: 'USD', value: 10, effectiveDate: '2026-10-10' }),
      ]);
      setSources({ SAT: { rateSource: 'manual', rateSourceConfig: null } });

      const result = await resolveCustomPairRate({
        userId: 1,
        pair: { baseCode: 'SAT', quoteCode: 'EUR' },
        date: DATE,
        isCustom: isCustomIn(['SAT']),
        resolveIsoRate: isoRates({ 'USD>EUR': 0.5 }),
      });

      expect(result.rate).toBe(2);
    });
  });

  describe('a pegged currency', () => {
    const resolvePair = ({
      baseCode,
      quoteCode,
      customCodes,
      resolveIsoRate = isoRates({}),
      date = DATE,
    }: {
      baseCode: string;
      quoteCode: string;
      customCodes: string[];
      resolveIsoRate?: ReturnType<typeof isoRates>;
      date?: Date;
    }) =>
      resolveCustomPairRate({
        userId: 1,
        pair: { baseCode, quoteCode },
        date,
        isCustom: isCustomIn(customCodes),
        resolveIsoRate,
      });

    it('is worth the factor times its peg currency, with no stored rate and no ISO lookup for the same currency', async () => {
      storeRates({});
      setSources({ USDT: peg({ pegCurrency: 'USD', factor: 1 }) });
      const resolveIsoRate = isoRates({});

      const result = await resolvePair({ baseCode: 'USDT', quoteCode: 'USD', customCodes: ['USDT'], resolveIsoRate });

      expect(result).toMatchObject({ baseCode: 'USDT', quoteCode: 'USD', rate: 1, custom: true });
      expect(resolveIsoRate).not.toHaveBeenCalled();
    });

    it('crosses the peg currency into the target with the ISO resolution of the same day', async () => {
      storeRates({});
      setSources({ USDT: peg({ pegCurrency: 'USD', factor: 1.02 }) });
      const resolveIsoRate = isoRates({ 'USD>EUR': 0.9 });

      const result = await resolvePair({ baseCode: 'USDT', quoteCode: 'EUR', customCodes: ['USDT'], resolveIsoRate });

      expect(result.rate).toBeCloseTo(1.02 * 0.9, 12);
      expect(resolveIsoRate).toHaveBeenCalledWith({ baseCode: 'USD', quoteCode: 'EUR' });
    });

    it('prices a pegged target by dividing, so the two directions are exact inverses', async () => {
      storeRates({});
      setSources({ USDT: peg({ pegCurrency: 'USD', factor: 4 }) });

      const result = await resolvePair({ baseCode: 'USD', quoteCode: 'USDT', customCodes: ['USDT'] });

      expect(result.rate).toBe(0.25);
    });

    it('ignores rows stored for the currency before it was pegged', async () => {
      storeRates({ 'USDT>USD': 7, 'USD>USDT': 0.14 });
      setSources({ USDT: peg({ pegCurrency: 'USD', factor: 1 }) });

      expect((await resolvePair({ baseCode: 'USDT', quoteCode: 'USD', customCodes: ['USDT'] })).rate).toBe(1);
      expect((await resolvePair({ baseCode: 'USD', quoteCode: 'USDT', customCodes: ['USDT'] })).rate).toBe(1);
    });

    it("follows a peg onto another custom currency through that currency's dated rate", async () => {
      storeRates({}, [
        datedRate({ baseCode: 'USDT', quoteCode: 'USD', value: 1, effectiveDate: '2026-01-01' }),
        datedRate({ baseCode: 'USDT', quoteCode: 'USD', value: 2, effectiveDate: '2026-02-01' }),
      ]);
      setSources({ USDC: peg({ pegCurrency: 'USDT', factor: 1 }) });
      const resolve = (day: string) =>
        resolvePair({
          baseCode: 'USDC',
          quoteCode: 'USD',
          customCodes: ['USDC', 'USDT'],
          date: new Date(`${day}T00:00:00.000Z`),
        });

      expect((await resolve('2026-01-15')).rate).toBe(1);
      expect((await resolve('2026-02-15')).rate).toBe(2);
      await expect(resolve('2025-12-31')).rejects.toBeInstanceOf(ExchangeRateUnavailableError);
    });

    it('chains pegs and multiplies their factors without floating-point noise', async () => {
      storeRates({});
      setSources({
        AAA: peg({ pegCurrency: 'BBB', factor: 0.1 }),
        BBB: peg({ pegCurrency: 'USD', factor: 0.2 }),
      });

      const result = await resolvePair({ baseCode: 'AAA', quoteCode: 'USD', customCodes: ['AAA', 'BBB'] });

      expect(result.rate).toBe(0.02);
    });

    it('is unavailable, and never reaches the ISO resolution, for a peg cycle between two currencies', async () => {
      storeRates({});
      setSources({ AAA: peg({ pegCurrency: 'BBB', factor: 1 }), BBB: peg({ pegCurrency: 'AAA', factor: 1 }) });
      const resolveIsoRate = isoRates({});

      await expect(
        resolvePair({ baseCode: 'AAA', quoteCode: 'EUR', customCodes: ['AAA', 'BBB'], resolveIsoRate }),
      ).rejects.toBeInstanceOf(ExchangeRateUnavailableError);
      await expect(
        resolvePair({ baseCode: 'EUR', quoteCode: 'BBB', customCodes: ['AAA', 'BBB'], resolveIsoRate }),
      ).rejects.toBeInstanceOf(ExchangeRateUnavailableError);
      expect(resolveIsoRate).not.toHaveBeenCalled();
    });

    it('is unavailable for a longer peg cycle and for a peg onto itself restored from a backup', async () => {
      storeRates({});
      setSources({
        AAA: peg({ pegCurrency: 'BBB', factor: 1 }),
        BBB: peg({ pegCurrency: 'CCC', factor: 1 }),
        CCC: peg({ pegCurrency: 'AAA', factor: 1 }),
        SELF: peg({ pegCurrency: 'SELF', factor: 1 }),
      });
      const customCodes = ['AAA', 'BBB', 'CCC', 'SELF'];

      await expect(resolvePair({ baseCode: 'AAA', quoteCode: 'USD', customCodes })).rejects.toBeInstanceOf(
        ExchangeRateUnavailableError,
      );
      await expect(resolvePair({ baseCode: 'SELF', quoteCode: 'USD', customCodes })).rejects.toBeInstanceOf(
        ExchangeRateUnavailableError,
      );
    });

    it.each([
      ['a missing config', null],
      ['a config of the wrong shape', { pegCurrency: 'USD' }],
      ['a zero factor', { pegCurrency: 'USD', factor: 0 }],
      ['a negative factor', { pegCurrency: 'USD', factor: -1 }],
      ['a string factor', { pegCurrency: 'USD', factor: '1' }],
      ['a config that is not an object', 'USD'],
    ])('is unavailable, not a guess, for a peg saved with %s', async (_name, rateSourceConfig) => {
      storeRates({ 'USDT>USD': 5 });
      setSources({ USDT: { rateSource: 'peg', rateSourceConfig } });

      await expect(resolvePair({ baseCode: 'USDT', quoteCode: 'USD', customCodes: ['USDT'] })).rejects.toBeInstanceOf(
        ExchangeRateUnavailableError,
      );
    });

    it('leaves a currency on manual rates alone when another one is pegged', async () => {
      storeRates({ 'SAT>USD': 0.001 });
      setSources({ USDT: peg({ pegCurrency: 'USD', factor: 1 }) });

      const result = await resolvePair({ baseCode: 'SAT', quoteCode: 'USD', customCodes: ['SAT', 'USDT'] });

      expect(result.rate).toBe(0.001);
    });
  });
});
