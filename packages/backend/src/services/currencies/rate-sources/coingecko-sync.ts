import type { CoingeckoRateSourceConfig } from '@bt/shared/types';
import { logger } from '@js/utils';
import UserExchangeRates, { toEffectiveDate } from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';

import {
  type CoingeckoDailyRate,
  fetchCoingeckoHistory,
  fetchCoingeckoLatestPrices,
  isCoingeckoRateLimitError,
} from './coingecko';
import { coingeckoRateSourceConfigSchema } from './index';
import { storeSyncedRates } from './store-synced-rates';

/** The Demo tier allows about 30 calls a minute; a sync leaves this long between two of its calls. */
const COINGECKO_SYNC_SPACING_MS = 2_500;

const SOURCE = 'coingecko';

interface Target {
  userId: number;
  currencyCode: string;
  /** The settings the target was loaded with: rates fetched for them are stored only while they stand. */
  rateSourceConfig: unknown;
}

/** The users who take one coin in one quote currency: it is fetched once for all of them. */
interface CoinGroup {
  coinId: string;
  quoteCurrency: string;
  targets: Target[];
}

interface CoingeckoSyncResult {
  /** Coins fetched, counting a coin once per quote currency. */
  coinsFetched: number;
  /** Users' currencies that got at least one new or changed rate. */
  currenciesUpdated: number;
  ratesWritten: number;
  failures: number;
}

const groupKey = ({ coinId, quoteCurrency }: { coinId: string; quoteCurrency: string }): string =>
  `${coinId}|${quoteCurrency}`;

const parseConfig = (rateSourceConfig: unknown): CoingeckoRateSourceConfig | null => {
  const parsed = coingeckoRateSourceConfigSchema.safeParse(rateSourceConfig);

  return parsed.success ? parsed.data : null;
};

/**
 * Fetches the last year of a coin's prices and stores them for the user's currency. Runs after the
 * rate source is saved; the save has committed by then, so a failure here is logged and the
 * currency stays on its source, which the daily sync backfills again while it has no rates.
 */
export const backfillCoingeckoRates = async ({
  userId,
  currencyCode,
}: {
  userId: number;
  currencyCode: string;
}): Promise<{ status: 'done'; ratesWritten: number } | { status: 'skipped' | 'failed' }> => {
  const held = await UsersCurrencies.findOne({ where: { userId, currencyCode, rateSource: SOURCE }, raw: true });
  const config = held ? parseConfig(held.rateSourceConfig) : null;
  if (!held || !config) return { status: 'skipped' };

  try {
    const rates = await fetchCoingeckoHistory({ coinId: config.coinId, quoteCurrency: config.quoteCurrency });
    const ratesWritten = await storeSyncedRates({
      userId,
      currencyCode,
      quoteCurrency: config.quoteCurrency,
      rates,
      kind: 'backfill',
      source: SOURCE,
      fetchedWith: { rateSourceConfig: held.rateSourceConfig },
    });

    return { status: 'done', ratesWritten };
  } catch (error) {
    logger.error(
      { message: `CoinGecko backfill failed for ${currencyCode} of user ${userId}`, error: error as Error },
      { code: 'COINGECKO_RATE_BACKFILL_FAILED' },
    );

    return { status: 'failed' };
  }
};

const loadGroups = async (): Promise<{ needHistory: CoinGroup[]; needLatest: CoinGroup[] }> => {
  const configured = await UsersCurrencies.findAll({
    where: { rateSource: SOURCE },
    attributes: ['userId', 'currencyCode', 'rateSourceConfig'],
    order: [
      ['userId', 'ASC'],
      ['currencyCode', 'ASC'],
    ],
    raw: true,
  });
  const withRates = await UserExchangeRates.findAll({
    where: { source: SOURCE },
    attributes: ['userId', 'baseCode', 'quoteCode'],
    group: ['userId', 'baseCode', 'quoteCode'],
    raw: true,
  });
  const hasRates = new Set(withRates.map((row) => `${row.userId}|${row.baseCode}|${row.quoteCode}`));

  const history = new Map<string, CoinGroup>();
  const latest = new Map<string, CoinGroup>();

  for (const row of configured) {
    const config = parseConfig(row.rateSourceConfig);
    if (!config) {
      logger.warn(`Skipping the CoinGecko source of ${row.currencyCode} of user ${row.userId}: unreadable config`);
      continue;
    }

    const bucket = hasRates.has(`${row.userId}|${row.currencyCode}|${config.quoteCurrency}`) ? latest : history;
    const key = groupKey(config);
    const group = bucket.get(key) ?? { coinId: config.coinId, quoteCurrency: config.quoteCurrency, targets: [] };
    group.targets.push({
      userId: row.userId,
      currencyCode: row.currencyCode,
      rateSourceConfig: row.rateSourceConfig,
    });
    bucket.set(key, group);
  }

  return { needHistory: [...history.values()], needLatest: [...latest.values()] };
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Daily sync of every user's CoinGecko-sourced currencies. A coin is fetched once per day however
 * many users take it, and each user gets the rate stored in their own configured quote currency.
 *
 * - A currency that has no rates from this source yet (its backfill failed, or it was never run)
 *   is backfilled with the last year instead.
 * - The others get today's price from one batched call per quote currency.
 * - A failed call is logged and leaves the last rate in force; a 429 ends the run, because every
 *   further call would be refused too. The next run starts again.
 */
export const syncCoingeckoRates = async ({
  spacingMs = COINGECKO_SYNC_SPACING_MS,
}: { spacingMs?: number } = {}): Promise<CoingeckoSyncResult> => {
  const result: CoingeckoSyncResult = { coinsFetched: 0, currenciesUpdated: 0, ratesWritten: 0, failures: 0 };
  const { needHistory, needLatest } = await loadGroups();
  if (!needHistory.length && !needLatest.length) return result;

  let requests = 0;
  let rateLimited = false;
  const beforeRequest = async () => {
    if (requests > 0 && spacingMs > 0) await sleep(spacingMs);
    requests += 1;
  };

  const fail = ({ error, what }: { error: unknown; what: string }) => {
    result.failures += 1;
    if (isCoingeckoRateLimitError(error)) rateLimited = true;
    logger.error(
      { message: `CoinGecko rate sync: ${what} failed, the last rates stay in force`, error: error as Error },
      { code: 'COINGECKO_RATE_SYNC_FAILED' },
    );
  };

  const store = async ({
    group,
    rates,
    kind,
  }: {
    group: CoinGroup;
    rates: CoingeckoDailyRate[];
    kind: 'backfill' | 'daily';
  }) => {
    for (const { userId, currencyCode, rateSourceConfig } of group.targets) {
      try {
        const written = await storeSyncedRates({
          userId,
          currencyCode,
          quoteCurrency: group.quoteCurrency,
          rates,
          kind,
          source: SOURCE,
          fetchedWith: { rateSourceConfig },
        });
        result.ratesWritten += written;
        if (written) result.currenciesUpdated += 1;
      } catch (error) {
        fail({ error, what: `storing ${currencyCode} for user ${userId}` });
      }
    }
  };

  for (const group of needHistory) {
    if (rateLimited) break;

    try {
      await beforeRequest();
      const rates = await fetchCoingeckoHistory({ coinId: group.coinId, quoteCurrency: group.quoteCurrency });
      result.coinsFetched += 1;
      await store({ group, rates, kind: 'backfill' });
    } catch (error) {
      fail({ error, what: `history of ${group.coinId}` });
    }
  }

  const byQuote = Map.groupBy(needLatest, (group) => group.quoteCurrency);
  for (const [quoteCurrency, groups] of byQuote) {
    if (rateLimited) break;

    try {
      const prices = await fetchCoingeckoLatestPrices({
        coinIds: groups.map((group) => group.coinId),
        quoteCurrency,
        beforeRequest,
      });
      const day = toEffectiveDate({ date: new Date() });

      for (const group of groups) {
        const rate = prices.get(group.coinId);
        result.coinsFetched += 1;

        if (rate === undefined) {
          logger.warn(`CoinGecko returned no ${quoteCurrency} price for ${group.coinId}; its last rate stays in force`);
          result.failures += 1;
          continue;
        }

        await store({ group, rates: [{ day, rate }], kind: 'daily' });
      }
    } catch (error) {
      fail({ error, what: `prices in ${quoteCurrency}` });
    }
  }

  return result;
};
