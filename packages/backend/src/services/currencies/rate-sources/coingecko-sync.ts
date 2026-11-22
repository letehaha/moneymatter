import type { CoingeckoRateSourceConfig } from '@bt/shared/types';
import { logger } from '@js/utils';
import UserExchangeRates, { toEffectiveDate } from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';
import { subDays } from 'date-fns';
import { literal, Op } from 'sequelize';

import { fetchCoingeckoHistory, fetchCoingeckoLatestPrices, isCoingeckoRateLimitError } from './coingecko';
import { coingeckoRateSourceConfigSchema } from './index';
import { storeSyncedRates, type SyncedDailyRate } from './store-synced-rates';

/** The Demo tier allows about 30 calls a minute; a sync leaves this long between two of its calls. */
const COINGECKO_SYNC_SPACING_MS = 2_500;

const SOURCE = 'coingecko';

interface Target {
  userId: number;
  currencyCode: string;
  /** The settings the target was loaded with: rates fetched for them are stored only while they stand. */
  rateSourceConfig: unknown;
  /** The newest day stored from this source in the quote currency; `undefined` when there is none. */
  newestDay: string | undefined;
  /** It has no rate from this source for yesterday or later, so it is filled from the history. */
  stale: boolean;
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

const parseConfig = ({ rateSourceConfig }: { rateSourceConfig: unknown }): CoingeckoRateSourceConfig | null => {
  const parsed = coingeckoRateSourceConfigSchema.safeParse(rateSourceConfig);

  return parsed.success ? parsed.data : null;
};

const loadGroups = async (): Promise<CoinGroup[]> => {
  const configured = await UsersCurrencies.findAll({
    where: { rateSource: SOURCE },
    attributes: ['userId', 'currencyCode', 'rateSourceConfig'],
    order: [
      ['userId', 'ASC'],
      ['currencyCode', 'ASC'],
    ],
    raw: true,
  });
  if (!configured.length) return [];

  const newestDays = (await UserExchangeRates.findAll({
    where: { source: SOURCE, userId: { [Op.in]: [...new Set(configured.map((row) => row.userId))] } },
    attributes: ['userId', 'baseCode', 'quoteCode', [literal('MAX("effectiveDate")::text'), 'newestDay']],
    group: ['userId', 'baseCode', 'quoteCode'],
    raw: true,
  })) as unknown as { userId: number; baseCode: string; quoteCode: string; newestDay: string }[];
  const newestDayOf = new Map(
    newestDays.map((row) => [`${row.userId}|${row.baseCode}|${row.quoteCode}`, row.newestDay]),
  );
  const yesterday = toEffectiveDate({ date: subDays(new Date(), 1) });

  const groups = new Map<string, CoinGroup>();

  for (const row of configured) {
    const config = parseConfig({ rateSourceConfig: row.rateSourceConfig });
    if (!config) {
      logger.warn(`Skipping the CoinGecko source of ${row.currencyCode} of user ${row.userId}: unreadable config`);
      continue;
    }

    const newestDay = newestDayOf.get(`${row.userId}|${row.currencyCode}|${config.quoteCurrency}`);
    const key = groupKey(config);
    const group = groups.get(key) ?? { coinId: config.coinId, quoteCurrency: config.quoteCurrency, targets: [] };
    group.targets.push({
      userId: row.userId,
      currencyCode: row.currencyCode,
      rateSourceConfig: row.rateSourceConfig,
      newestDay,
      stale: newestDay === undefined || newestDay < yesterday,
    });
    groups.set(key, group);
  }

  return [...groups.values()];
};

const sleep = ({ ms }: { ms: number }) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Daily sync of every user's CoinGecko-sourced currencies. A coin is fetched once per day however
 * many users take it, and each user gets the rate stored in their own configured quote currency.
 *
 * - Today's price comes from one batched call per quote currency.
 * - A currency whose newest rate from this source in its quote is older than yesterday (none yet,
 *   or a run was missed) stores it only together with the days it lacks, from the coin's history,
 *   so a failed history call leaves it to the next run. Days it already holds are left alone. A
 *   coin with no price today is not fetched for history.
 * - A failed call is logged and leaves the last rate in force; a 429 ends the run, because every
 *   further call would be refused too. The next run starts again.
 */
export const syncCoingeckoRates = async ({
  spacingMs = COINGECKO_SYNC_SPACING_MS,
}: { spacingMs?: number } = {}): Promise<CoingeckoSyncResult> => {
  const result: CoingeckoSyncResult = { coinsFetched: 0, currenciesUpdated: 0, ratesWritten: 0, failures: 0 };
  const groups = await loadGroups();
  if (!groups.length) return result;

  const priced = new Map<CoinGroup, number>();

  let requests = 0;
  let rateLimited = false;
  const beforeRequest = async () => {
    if (requests > 0 && spacingMs > 0) await sleep({ ms: spacingMs });
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
    ratesOf,
    kind,
  }: {
    group: CoinGroup;
    ratesOf: (target: Target) => SyncedDailyRate[];
    kind: 'backfill' | 'daily';
  }) => {
    for (const target of group.targets) {
      const { userId, currencyCode, rateSourceConfig } = target;
      try {
        const written = await storeSyncedRates({
          userId,
          currencyCode,
          quoteCurrency: group.quoteCurrency,
          rates: ratesOf(target),
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

  const today = toEffectiveDate({ date: new Date() });

  for (const [quoteCurrency, quoteGroups] of Map.groupBy(groups, (group) => group.quoteCurrency)) {
    if (rateLimited) break;

    try {
      const prices = await fetchCoingeckoLatestPrices({
        coinIds: quoteGroups.map((group) => group.coinId),
        quoteCurrency,
        beforeRequest,
      });

      for (const group of quoteGroups) {
        const rate = prices.get(group.coinId);
        result.coinsFetched += 1;

        if (rate === undefined) {
          logger.warn(`CoinGecko returned no ${quoteCurrency} price for ${group.coinId}; its last rate stays in force`);
          result.failures += 1;
          continue;
        }

        priced.set(group, rate);
        await store({ group, ratesOf: ({ stale }) => (stale ? [] : [{ day: today, rate }]), kind: 'daily' });
      }
    } catch (error) {
      fail({ error, what: `prices in ${quoteCurrency}` });
    }
  }

  for (const group of groups) {
    if (rateLimited) break;
    const rate = priced.get(group);
    if (rate === undefined || !group.targets.some(({ stale }) => stale)) continue;

    try {
      await beforeRequest();
      const rates = await fetchCoingeckoHistory({ coinId: group.coinId, quoteCurrency: group.quoteCurrency });
      await store({
        group,
        ratesOf: ({ stale, newestDay }) =>
          stale
            ? [
                ...rates.filter(({ day }) => day < today && (newestDay === undefined || day > newestDay)),
                { day: today, rate },
              ]
            : [],
        kind: 'backfill',
      });
    } catch (error) {
      fail({ error, what: `history of ${group.coinId}` });
    }
  }

  return result;
};
