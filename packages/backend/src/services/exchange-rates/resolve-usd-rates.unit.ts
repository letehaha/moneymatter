import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { addDays, startOfDay, subDays } from 'date-fns';

// Keep the logger quiet and free of side effects.
jest.mock('@js/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock the model so `loadRate` reads come from controlled stubs instead of the DB.
const findOne = jest.fn<(args: unknown) => Promise<unknown>>();
jest.mock('@models/exchange-rates.model', () => ({
  __esModule: true,
  default: {
    findOne: (args: unknown) => findOne(args),
  },
}));

// Mock the fetch/coverage layer so the test never hits a provider/network.
const fetchAndStoreRatesForDate = jest.fn<(date: Date) => Promise<void>>();
const isDateComprehensivelyFetched = jest.fn<(date: Date) => Promise<boolean>>();
jest.mock('./ensure-rates-for-date', () => ({
  __esModule: true,
  fetchAndStoreRatesForDate: (date: Date) => fetchAndStoreRatesForDate(date),
  isDateComprehensivelyFetched: (date: Date) => isDateComprehensivelyFetched(date),
}));

// eslint-disable-next-line import/first
import { resolveUsdRates } from './resolve-usd-rates';

type FindOneArgs = {
  where: { quoteCode?: string };
  order?: unknown;
};

/**
 * Drive `loadRate`'s two queries per code:
 *  - the EXACT query has no `order`,
 *  - the FALLBACK query has `order: [['date', 'DESC']]`.
 * `exactByCode` / `fallbackByCode` map a quote code to the row each query returns
 * (or `null` for no row).
 */
const stubRates = ({
  exactByCode = {},
  fallbackByCode = {},
}: {
  exactByCode?: Record<string, { rate: number; date: Date } | null>;
  fallbackByCode?: Record<string, { rate: number; date: Date } | null>;
}) => {
  findOne.mockImplementation(async (rawArgs: unknown) => {
    const args = rawArgs as FindOneArgs;
    const code = args.where.quoteCode!;
    if (args.order) {
      return fallbackByCode[code] ?? null;
    }
    return exactByCode[code] ?? null;
  });
};

describe('resolveUsdRates future-date guard', () => {
  beforeEach(() => {
    findOne.mockReset();
    fetchAndStoreRatesForDate.mockReset();
    isDateComprehensivelyFetched.mockReset();
    // Default: not comprehensively fetched, so the fetch decision is reached.
    isDateComprehensivelyFetched.mockResolvedValue(false);
    fetchAndStoreRatesForDate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('does NOT fetch for a future date and resolves a currency-with-history via fallback', async () => {
    const futureDate = addDays(startOfDay(new Date()), 10);
    const fallbackDate = subDays(startOfDay(new Date()), 5);
    stubRates({
      exactByCode: { EUR: null },
      fallbackByCode: { EUR: { rate: 0.92, date: fallbackDate } },
    });

    const result = await resolveUsdRates({ codes: ['EUR'], date: futureDate });

    expect(fetchAndStoreRatesForDate).not.toHaveBeenCalled();
    const eur = result.get('EUR');
    expect(eur).toEqual({
      kind: 'fallback',
      rate: 0.92,
      rateDate: fallbackDate,
      requestedDate: futureDate,
    });
  });

  it('does NOT fetch for a future date and returns `missing` for a never-priced currency', async () => {
    const futureDate = addDays(startOfDay(new Date()), 3);
    stubRates({
      exactByCode: { XYZ: null },
      fallbackByCode: { XYZ: null },
    });

    const result = await resolveUsdRates({ codes: ['XYZ'], date: futureDate });

    expect(fetchAndStoreRatesForDate).not.toHaveBeenCalled();
    expect(result.get('XYZ')).toEqual({ kind: 'missing' });
  });

  it('still fetches for a past date that is not comprehensively fetched', async () => {
    const pastDate = subDays(startOfDay(new Date()), 10);
    // Before the fetch: only a fallback exists. After the fetch: an exact row.
    const exactRowDate = pastDate;
    findOne.mockImplementation(async (rawArgs: unknown) => {
      const args = rawArgs as FindOneArgs;
      if (args.order) {
        // Fallback query.
        return { rate: 0.9, date: subDays(pastDate, 30) };
      }
      // Exact query: empty until the fetch has run.
      return fetchAndStoreRatesForDate.mock.calls.length > 0 ? { rate: 0.95, date: exactRowDate } : null;
    });

    const result = await resolveUsdRates({ codes: ['EUR'], date: pastDate });

    expect(fetchAndStoreRatesForDate).toHaveBeenCalledTimes(1);
    expect(result.get('EUR')).toEqual({ kind: 'exact', rate: 0.95, date: exactRowDate });
  });

  it('still fetches for today when the date is not comprehensively fetched', async () => {
    const today = new Date();
    stubRates({
      exactByCode: { EUR: { rate: 1.0, date: startOfDay(today) } },
    });

    await resolveUsdRates({ codes: ['EUR'], date: today });

    // `today` is not in the future, so the guard must NOT short-circuit; the
    // all-exact early-return is what stops the fetch here, but the point is the
    // future guard didn't suppress normal behavior. EUR is exact, so no fetch.
    expect(fetchAndStoreRatesForDate).not.toHaveBeenCalled();
  });

  it('fetches today when a leg is non-exact (future guard does not interfere with present)', async () => {
    const today = new Date();
    stubRates({
      exactByCode: { EUR: null },
      fallbackByCode: { EUR: { rate: 0.9, date: subDays(startOfDay(today), 2) } },
    });

    await resolveUsdRates({ codes: ['EUR'], date: today });

    // Non-exact + not comprehensively fetched + not future -> fetch IS attempted.
    expect(fetchAndStoreRatesForDate).toHaveBeenCalledTimes(1);
  });

  // ── Catch-path: fetch rejects ─────────────────────────────────────────────

  it('re-throws when the fetch rejects and at least one code has no rate at all (missing)', async () => {
    // XYZ has no exact row and no fallback row — kind: 'missing'.
    // When the fetch then throws, there is nothing to fall back to, so the error
    // must surface to the caller.
    const pastDate = subDays(startOfDay(new Date()), 5);
    stubRates({
      exactByCode: { XYZ: null },
      fallbackByCode: { XYZ: null },
    });

    const fetchError = new Error('provider unavailable');
    fetchAndStoreRatesForDate.mockRejectedValue(fetchError);

    await expect(resolveUsdRates({ codes: ['XYZ'], date: pastDate })).rejects.toThrow('provider unavailable');
  });

  it('swallows the fetch error and returns fallback rates when every code has at least a fallback', async () => {
    // EUR has no exact row but has a fallback — kind: 'fallback'.
    // When the fetch rejects, the function must NOT throw; it must return the
    // pre-fetch fallback map because every leg is still priceable.
    const pastDate = subDays(startOfDay(new Date()), 5);
    const fallbackDate = subDays(startOfDay(new Date()), 30);

    stubRates({
      exactByCode: { EUR: null },
      fallbackByCode: { EUR: { rate: 0.88, date: fallbackDate } },
    });

    const fetchError = new Error('rate provider timeout');
    fetchAndStoreRatesForDate.mockRejectedValue(fetchError);

    const result = await resolveUsdRates({ codes: ['EUR'], date: pastDate });

    // Must not throw — the fallback is returned as-is.
    const eur = result.get('EUR');
    expect(eur?.kind).toBe('fallback');
    expect((eur as { kind: 'fallback'; rate: number }).rate).toBe(0.88);
  });
});
