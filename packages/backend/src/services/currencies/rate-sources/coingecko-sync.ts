import type { CoingeckoRateSourceConfig } from '@bt/shared/types';
import { logger } from '@js/utils';
import UserExchangeRates, { toEffectiveDate } from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';
import { withTransaction } from '@services/common/with-transaction';
import { Op } from 'sequelize';

import { recomputeCustomRefAmounts } from '../recompute-custom-ref-amounts.service';
import type { CustomRateChange } from '../recompute-scope';
import {
  type CoingeckoDailyRate,
  fetchCoingeckoHistory,
  fetchCoingeckoLatestPrices,
  isCoingeckoRateLimitError,
} from './coingecko';
import { coingeckoRateSourceConfigSchema } from './index';

/** The Demo tier allows about 30 calls a minute; a sync leaves this long between two of its calls. */
export const COINGECKO_SYNC_SPACING_MS = 2_500;

const SOURCE = 'coingecko';

interface Target {
  userId: number;
  currencyCode: string;
}

/** The users who take one coin in one quote currency: it is fetched once for all of them. */
interface CoinGroup {
  coinId: string;
  quoteCurrency: string;
  targets: Target[];
}

export interface CoingeckoSyncResult {
  /** Coins fetched, counting a coin once per quote currency. */
  coinsFetched: number;
  /** Users' currencies that got at least one new or changed rate. */
  currenciesUpdated: number;
  ratesWritten: number;
  failures: number;
}

const groupKey = ({ coinId, quoteCurrency }: { coinId: string; quoteCurrency: string }): string =>
  `${coinId}|${quoteCurrency}`;

/**
 * Writes a coin's rates for one user's currency and values the rows they reach again.
 *
 * A day the user set by hand keeps their rate. A day this source wrote before is replaced when the
 * price differs. A rate for a day that had none is new: when it is today's it only fills rows
 * waiting for a rate, and a backfill (which writes days that may have been valued with an earlier
 * rate) values the rows of those days again.
 */
export const storeCoingeckoRates = withTransaction(
  async ({
    userId,
    currencyCode,
    quoteCurrency,
    rates,
    kind,
  }: {
    userId: number;
    currencyCode: string;
    quoteCurrency: string;
    rates: CoingeckoDailyRate[];
    /** `backfill` writes a series of days; `daily` writes the rate of a new day. */
    kind: 'backfill' | 'daily';
  }): Promise<number> => {
    if (!rates.length) return 0;

    const existing = await UserExchangeRates.findAll({
      where: {
        userId,
        baseCode: currencyCode,
        quoteCode: quoteCurrency,
        effectiveDate: { [Op.in]: rates.map((rate) => rate.day) },
      },
    });
    const existingByDay = new Map(existing.map((row) => [row.effectiveDate, row]));

    const added: string[] = [];
    const replaced: string[] = [];
    const created: { day: string; rate: number }[] = [];

    for (const { day, rate } of rates) {
      const known = existingByDay.get(day);

      if (!known) {
        created.push({ day, rate });
        added.push(day);
      } else if (known.source === SOURCE && Number(known.rate) !== rate) {
        await UserExchangeRates.update(
          { rate },
          { where: { userId, baseCode: currencyCode, quoteCode: quoteCurrency, effectiveDate: day } },
        );
        replaced.push(day);
      }
    }

    if (created.length) {
      await UserExchangeRates.bulkCreate(
        created.map(({ day, rate }) => ({
          userId,
          baseCode: currencyCode,
          quoteCode: quoteCurrency,
          rate,
          effectiveDate: day,
          source: SOURCE,
        })),
      );
    }

    const written = [...added, ...replaced].toSorted();
    if (!written.length) return 0;

    const changes: CustomRateChange[] = [];

    if (kind === 'backfill') {
      changes.push({ currencyCode, from: written[0]!, to: null, mode: 'recompute' });
    } else {
      if (replaced.length) changes.push({ currencyCode, from: replaced[0]!, to: null, mode: 'recompute' });
      if (added.length) changes.push({ currencyCode, from: added[0]!, to: null, mode: 'fill' });
    }

    await recomputeCustomRefAmounts({ userId, changes });

    return written.length;
  },
);

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
  if (!config) return { status: 'skipped' };

  try {
    const rates = await fetchCoingeckoHistory({ coinId: config.coinId, quoteCurrency: config.quoteCurrency });
    const ratesWritten = await storeCoingeckoRates({
      userId,
      currencyCode,
      quoteCurrency: config.quoteCurrency,
      rates,
      kind: 'backfill',
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
    group.targets.push({ userId: row.userId, currencyCode: row.currencyCode });
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
    for (const { userId, currencyCode } of group.targets) {
      try {
        const written = await storeCoingeckoRates({
          userId,
          currencyCode,
          quoteCurrency: group.quoteCurrency,
          rates,
          kind,
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
