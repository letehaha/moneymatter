import type { CoingeckoCoinSearchResult } from '@bt/shared/types';
import { SECURITY_PROVIDER } from '@bt/shared/types/investments';
import { toEffectiveDate } from '@models/user-exchange-rates.model';
import {
  createCoingeckoClient,
  requireCoinGeckoKey,
} from '@services/investments/data-providers/clients/coingecko-client';
import { CoinGeckoDataProvider } from '@services/investments/data-providers/coingecko-provider';
import { subDays } from 'date-fns';

/**
 * The Demo tier serves a year of daily history. A range wider than 90 days comes back with one
 * point per day, so the backfill always asks for the whole window, whatever the user's oldest row.
 */
export const COINGECKO_HISTORY_DAYS = 364;

/** `/simple/price` takes about 500 ids a call; stay well under it. */
export const COINGECKO_PRICE_BATCH_SIZE = 250;

/** One day's price of a coin: `day` is the UTC calendar day (`YYYY-MM-DD`). */
export interface CoingeckoDailyRate {
  day: string;
  rate: number;
}

/**
 * The price of each UTC day out of the `[timestampMs, price]` points CoinGecko returns. A daily
 * series has one point per day (its 00:00 UTC price) and the last one is the live price of today,
 * so the latest point of a day is the day's rate. Points without a positive finite price are dropped.
 */
export const toDailyRates = ({ points }: { points: ReadonlyArray<ReadonlyArray<number | null> | null> }) => {
  const latestOfDay = new Map<string, { timestamp: number; rate: number }>();

  for (const point of points) {
    if (!Array.isArray(point) || point.length !== 2) continue;

    const [timestamp, price] = point;
    if (
      typeof timestamp !== 'number' ||
      !Number.isFinite(timestamp) ||
      typeof price !== 'number' ||
      !Number.isFinite(price) ||
      price <= 0
    )
      continue;

    const day = toEffectiveDate({ date: new Date(timestamp) });
    const known = latestOfDay.get(day);
    if (!known || known.timestamp < timestamp) latestOfDay.set(day, { timestamp, rate: price });
  }

  return [...latestOfDay.entries()]
    .map(([day, { rate }]): CoingeckoDailyRate => ({ day, rate }))
    .toSorted((a, b) => a.day.localeCompare(b.day));
};

/** The coins matching a query, ranked by market cap, in the shape the rate-source editor lists. */
export const searchCoingeckoCoins = async ({ query }: { query: string }): Promise<CoingeckoCoinSearchResult[]> => {
  const provider = new CoinGeckoDataProvider({ apiKey: requireCoinGeckoKey() });
  const results = await provider.searchSecurities(query);

  return results
    .filter((result) => result.providerName === SECURITY_PROVIDER.coingecko)
    .map((result) => ({
      coinId: result.providerSymbol,
      symbol: result.symbol,
      name: result.name,
      logoUrl: result.logoUrl ?? null,
      marketCapRank: result.marketCapRank ?? null,
    }));
};

/** Every day of the last year the coin has a price for, in the quote currency. */
export const fetchCoingeckoHistory = async ({
  coinId,
  quoteCurrency,
  now = new Date(),
}: {
  coinId: string;
  quoteCurrency: string;
  now?: Date;
}): Promise<CoingeckoDailyRate[]> => {
  const client = createCoingeckoClient({ apiKey: requireCoinGeckoKey() });
  const response = await client.coins.marketChart.getRange(coinId, {
    vs_currency: quoteCurrency.toLowerCase(),
    from: String(Math.floor(subDays(now, COINGECKO_HISTORY_DAYS).getTime() / 1000)),
    to: String(Math.floor(now.getTime() / 1000)),
    precision: 'full',
  });

  return toDailyRates({ points: response.prices ?? [] });
};

/**
 * Today's price of several coins in one quote currency, one call per batch. A coin CoinGecko did
 * not price is missing from the map; a failed batch throws, so the caller keeps the last rates.
 */
export const fetchCoingeckoLatestPrices = async ({
  coinIds,
  quoteCurrency,
  beforeRequest,
}: {
  coinIds: string[];
  quoteCurrency: string;
  /** Runs before every request, so the caller can space them out. */
  beforeRequest?: () => Promise<void>;
}): Promise<Map<string, number>> => {
  const client = createCoingeckoClient({ apiKey: requireCoinGeckoKey() });
  const quote = quoteCurrency.toLowerCase();
  const prices = new Map<string, number>();

  for (let start = 0; start < coinIds.length; start += COINGECKO_PRICE_BATCH_SIZE) {
    const batch = coinIds.slice(start, start + COINGECKO_PRICE_BATCH_SIZE);
    await beforeRequest?.();

    const response = (await client.simple.price.get({
      ids: batch.join(','),
      vs_currencies: quote,
      precision: 'full',
    })) as Record<string, Record<string, number | undefined> | undefined>;

    for (const coinId of batch) {
      const price = response[coinId]?.[quote];
      if (typeof price === 'number' && Number.isFinite(price) && price > 0) prices.set(coinId, price);
    }
  }

  return prices;
};

/** Whether the error is CoinGecko saying the key ran out of calls for now. */
export const isCoingeckoRateLimitError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 429;
