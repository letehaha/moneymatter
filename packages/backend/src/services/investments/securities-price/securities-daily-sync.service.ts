import { ASSET_CLASS, PORTFOLIO_BENCHMARKS, SECURITY_PROVIDER, SECURITY_TYPE } from '@bt/shared/types';
import { logger } from '@js/utils';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import { withLock } from '@services/common/lock';
import { subDays } from 'date-fns';
import { Op, WhereOptions, literal } from 'sequelize';

import { dataProviderFactory } from '../data-providers';
import { BulkPriceData, toProviderSymbol } from '../data-providers/base-provider';
import { bucketByUtcDay, startOfDayUtc } from './pricing-anchor';

/**
 * Providers publish end-of-day bars with variable lag (Yahoo's EU bars can
 * appear a full day late), so a run that only asked for yesterday would
 * permanently lose any day it happened to miss. Each stocks run re-requests
 * this many trailing days; upserts on (securityId, date) make overlap free.
 */
export const STOCKS_LOOKBACK_DAYS = 7;

// A benchmark resolves to its Yahoo row, or to another provider's row with the same symbol and currency.
const BENCHMARK_SYMBOLS = Object.values(PORTFOLIO_BENCHMARKS).map(({ providerSymbol }) => providerSymbol);
const BENCHMARK_LISTINGS = Object.values(PORTFOLIO_BENCHMARKS).map(({ providerSymbol, currencyCode }) => ({
  symbol: providerSymbol,
  currencyCode,
}));

/**
 * Sentry alert fires only when both hold: a quarter of the queue failed AND
 * at least this many securities. The floor keeps a small instance with one
 * dead symbol from warning every run.
 */
const FAILED_SYNC_WARN_RATIO = 0.25;
const FAILED_SYNC_WARN_MIN_SECURITIES = 5;

/** All counters are per security, not per stored price row. */
interface SecuritiesPricesSyncResult {
  totalProcessed: number;
  successfulUpdates: number;
  failedUpdates: number;
  errors: Array<{ securityId: string; symbol: string | null; error: string }>;
}

type SyncLabel = 'stocks-daily' | 'crypto-hourly';

interface SyncOptions {
  /**
   * Sequelize WHERE clause restricting which securities are processed. Stocks
   * sync excludes crypto via `Op.notIn`; crypto sync whitelists crypto via
   * `Op.in`. Pass `undefined` to process every held, watched or benchmark security.
   */
  assetClassWhere: WhereOptions | undefined;
  /**
   * The timestamp passed to the composite provider as the "forDate" anchor.
   * Stocks: midnight UTC of yesterday. Crypto: now.
   */
  forDate: Date;
  /**
   * Start of the fetch window passed to the composite provider. Stocks set it
   * `STOCKS_LOOKBACK_DAYS` before `forDate`; crypto omits it (single
   * current-price snapshot).
   */
  fetchStartDate?: Date;
  /**
   * Maps one security's provider bars to the rows to store. Each returned
   * bar's `date` is written to the `date` column verbatim and must be unique
   * within the array, or the bulk upsert's ON CONFLICT clause rejects the
   * whole batch.
   */
  prepareBars: (bars: BulkPriceData[]) => BulkPriceData[];
  /** Tagged log label used for traceability. */
  label: SyncLabel;
}

/**
 * The type to backfill onto an untyped security. A stocks row Yahoo calls a mutual fund is a
 * UCITS ETF: search maps genuine mutual funds to fixed income, which can't be added.
 */
const typeToBackfill = ({ security, bars }: { security: Securities; bars: BulkPriceData[] }) => {
  if (security.securityType) return null;
  const reported = bars[0]?.securityType;
  return reported === SECURITY_TYPE.mutual_fund && security.assetClass === ASSET_CLASS.stocks
    ? SECURITY_TYPE.etf
    : reported;
};

/**
 * Securities price sync that prioritizes securities with stale pricing data.
 *
 * Features:
 * 1. Queries held or watched securities, scoped by `assetClassWhere`.
 * 2. Prioritizes by pricingLastSyncedAt (oldest first).
 * 3. Uses composite data provider for automatic provider routing.
 * 4. Stores one row per bar returned by `prepareBars`.
 * 5. Updates pricingLastSyncedAt after successful sync.
 *
 * No `withTransaction` wrapper: bulk and individual upserts are idempotent
 * (unique index on `securityId, date`), and wrapping the whole run in one
 * transaction would roll back successfully-upserted rows if the trailing
 * `pricingLastSyncedAt` patch failed — silently turning a partial-success run
 * into total data loss with a misleading success counter in the result.
 */
const securitiesPricesSyncImpl = async (options: SyncOptions): Promise<SecuritiesPricesSyncResult> => {
  const { assetClassWhere, forDate, fetchStartDate, prepareBars, label } = options;
  logger.info(`[${label}] Starting securities prices sync`);

  // Securities with a non-excluded holding or on a watchlist, in live portfolios, plus the portfolio
  // benchmarks, prioritized by staleness.
  // `providerSymbol` is the canonical id since crypto display symbols are not unique;
  // a security may still have a NULL legacy `symbol`, but `providerSymbol` is NOT NULL.
  const securitiesFromDb = await Securities.findAll({
    where: {
      [Op.and]: [
        assetClassWhere ?? {},
        {
          [Op.or]: [
            {
              id: {
                [Op.in]: literal(`(
                  SELECT h."securityId" FROM "Holdings" h
                  JOIN "Portfolios" p ON p."id" = h."portfolioId" AND p."deletedAt" IS NULL
                  WHERE h."excluded" = false
                  UNION
                  SELECT w."securityId" FROM "WatchlistItems" w
                  JOIN "Portfolios" p ON p."id" = w."portfolioId" AND p."deletedAt" IS NULL
                )`),
              },
            },
            { providerName: SECURITY_PROVIDER.yahoo, providerSymbol: { [Op.in]: BENCHMARK_SYMBOLS } },
            { assetClass: { [Op.ne]: ASSET_CLASS.crypto }, [Op.or]: BENCHMARK_LISTINGS },
          ],
        },
      ],
    },
    order: [['pricingLastSyncedAt', 'ASC NULLS FIRST']], // Prioritize oldest/never-synced first
    raw: false, // Need model instances to update pricingLastSyncedAt
  });

  if (securitiesFromDb.length === 0) {
    logger.info(`[${label}] No held or watched securities found for sync`);
    return {
      totalProcessed: 0,
      successfulUpdates: 0,
      failedUpdates: 0,
      errors: [],
    };
  }

  logger.info(`[${label}] Found ${securitiesFromDb.length} securities to sync, prioritized by staleness`);

  const result: SecuritiesPricesSyncResult = {
    totalProcessed: securitiesFromDb.length,
    successfulUpdates: 0,
    failedUpdates: 0,
    errors: [],
  };

  // Use composite provider to fetch all prices efficiently
  const compositeProvider = dataProviderFactory.getProvider(SECURITY_PROVIDER.composite);

  const securitiesById = new Map<string, Securities>(securitiesFromDb.map((s) => [s.id, s]));
  const securitiesInputs = securitiesFromDb.map((s) => ({
    securityId: s.id,
    symbol: s.symbol ?? s.providerSymbol,
    providerSymbol: toProviderSymbol(s.providerSymbol),
    assetClass: s.assetClass,
  }));

  logger.info(`[${label}] Fetching prices for ${securitiesById.size} securities using composite provider`);

  // Only the provider fetch is wrapped — a total fetch failure is the one
  // scenario that should mark every requested security as failed. Failures
  // from per-row work (upserts, the `pricingLastSyncedAt` patch) are handled
  // in their own narrow try/catch blocks below so their errors surface with
  // accurate context instead of being mis-reported as a fetch failure.
  let fetchedPrices: Map<string, BulkPriceData[]>;
  try {
    // Composite returns a Map keyed by securityId; the type guarantees every
    // value carries the originating securityId, so no defensive guards are
    // needed when consuming it.
    fetchedPrices = await compositeProvider.fetchPricesForSecurities(securitiesInputs, forDate, {
      startDate: fetchStartDate,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({
      message: `[${label}] Bulk price fetch failed for all securities`,
      error: error as Error,
    });
    result.failedUpdates = securitiesInputs.length;
    for (const input of securitiesInputs) {
      result.errors.push({
        securityId: input.securityId,
        symbol: input.symbol,
        error: errorMessage,
      });
    }
    return result;
  }

  const securityPricesToUpsert: {
    securityId: string;
    date: Date;
    priceClose: string;
    source: SECURITY_PROVIDER | undefined;
  }[] = [];

  let securitiesIdsToPatch: string[] = [];
  const securityIdsByBackfillType = new Map<SECURITY_TYPE, string[]>();

  // Store fetched prices and update timestamps
  for (const [securityId, rawBars] of fetchedPrices) {
    if (!securitiesById.has(securityId)) {
      // Composite returned a securityId we didn't ask for. This should be
      // impossible — composite only fetches inputs we supplied — so it
      // signals a provider bug or data corruption.
      logger.error(
        `[${label}] Composite returned unrequested securityId "${securityId}" ` +
          `(providerSymbol "${rawBars[0]?.providerSymbol}" from ${rawBars[0]?.providerName}). Dropping.`,
      );
      continue;
    }

    const backfillType = typeToBackfill({ security: securitiesById.get(securityId)!, bars: rawBars });
    if (backfillType) {
      securityIdsByBackfillType.set(backfillType, [...(securityIdsByBackfillType.get(backfillType) ?? []), securityId]);
    }

    for (const priceData of prepareBars(rawBars)) {
      securityPricesToUpsert.push({
        securityId,
        date: priceData.date,
        priceClose: priceData.priceClose.toString(),
        source: priceData.providerName,
      });
    }

    securitiesIdsToPatch.push(securityId);
  }

  const fetchedSecuritiesCount = securitiesIdsToPatch.length;

  const failedPricesUpdates: typeof securityPricesToUpsert = [];

  if (securityPricesToUpsert.length === 0) {
    logger.info(`[${label}] No security prices to store`);
  } else {
    // TODO: for high amount of securities, consider wrapping everything in batches
    // and try do bulk/individual updates for chunks of 50-100 symbols. If there will
    // be 1000 of securities, but bulk will fail, we will need to process all 1000
    // individually – it's too costly.
    try {
      // No `validate: true`: Sequelize runs per-instance validation before
      // injecting timestamps, so the explicit `@Column({ allowNull: false })`
      // on SecurityPricing.createdAt/updatedAt always trips the allowNull
      // validator with "createdAt cannot be null". The DB still enforces
      // NOT NULL at INSERT and the Money setter validates priceClose, so
      // dropping app-layer validation loses no real coverage.
      await SecurityPricing.bulkCreate(securityPricesToUpsert, {
        updateOnDuplicate: ['priceClose', 'source'],
      });

      result.successfulUpdates = fetchedSecuritiesCount;
      logger.info(
        `[${label}] Bulk created/updated ${securityPricesToUpsert.length} price rows for ${fetchedSecuritiesCount} securities`,
      );
    } catch (bulkError) {
      // A bulk failure indicates a schema/constraint mismatch or a transient
      // DB issue — both deserve more visibility than a buried info line. Log
      // at error so Sentry captures the stack via logger.error's Error-aware
      // path (the warn variant only supports plain-string messages).
      logger.error({
        message: `[${label}] Bulk create failed; falling back to individual upserts for ${securityPricesToUpsert.length} records`,
        error: bulkError as Error,
      });

      const failedBySecurityId = new Map<string, string>();
      for (const priceData of securityPricesToUpsert) {
        try {
          await SecurityPricing.upsert(priceData);
        } catch (individualError) {
          failedPricesUpdates.push(priceData);

          const security = securitiesById.get(priceData.securityId);
          const errorMessage = individualError instanceof Error ? individualError.message : 'Unknown error';
          if (!failedBySecurityId.has(priceData.securityId)) {
            failedBySecurityId.set(priceData.securityId, errorMessage);
          }

          logger.error(
            `[${label}] Failed to upsert price for security ${security?.symbol || priceData.securityId}: ${errorMessage}`,
          );
        }
      }

      result.failedUpdates += failedBySecurityId.size;
      result.successfulUpdates = fetchedSecuritiesCount - failedBySecurityId.size;
      for (const [securityId, error] of failedBySecurityId) {
        result.errors.push({
          securityId,
          symbol: securitiesById.get(securityId)?.symbol || null,
          error,
        });
      }
    }
  }

  if (failedPricesUpdates.length) {
    // If some securities prices failed to update, filter them out and don't update `pricingLastSyncedAt`
    securitiesIdsToPatch = securitiesIdsToPatch.filter((i) => !failedPricesUpdates.some((e) => e.securityId === i));
  }

  // Securities the provider returned nothing for. The stocks fetch window
  // always spans open market days (and crypto trades 24/7), so an empty
  // result is a real gap, never "market was closed".
  const missedInputs = securitiesInputs.filter((s) => !fetchedPrices.has(s.securityId));

  if (missedInputs.length > 0) {
    // Info level, not warn: the logger sends all warn records to Sentry, and a
    // single symbol with no price is usually a normal provider gap (delisted,
    // low trade volume). Broad failures surface via the ratio warn below.
    logger.info(
      `[${label}] ${missedInputs.length} symbols had no price data from provider: ${missedInputs.map((s) => s.symbol).join(', ')}`,
    );

    // Advance `pricingLastSyncedAt` so a permanently-unfetchable security
    // doesn't dominate the staleness-prioritised queue run after run.
    for (const { securityId, symbol } of missedInputs) {
      result.failedUpdates++;
      result.errors.push({
        securityId,
        symbol,
        error: 'No price data returned from provider',
      });
      securitiesIdsToPatch.push(securityId);
    }
  }

  if (securitiesIdsToPatch.length > 0) {
    try {
      await Securities.update(
        { pricingLastSyncedAt: new Date() },
        {
          where: {
            id: { [Op.in]: securitiesIdsToPatch },
          },
        },
      );
      logger.info(`[${label}] Updated pricingLastSyncedAt for ${securitiesIdsToPatch.length} securities`);
    } catch (patchError) {
      // Price rows are persisted (independently correct), but the staleness
      // queue did not advance — those securities will be reprocessed next run.
      // Re-throw so the cron wrapper / manual-trigger controller reports
      // `ok: false` instead of silently returning a misleadingly-successful
      // result (prices saved, queue stuck).
      logger.error({
        message: `[${label}] Failed to advance pricingLastSyncedAt for ${securitiesIdsToPatch.length} securities`,
        error: patchError instanceof Error ? patchError : new Error(String(patchError)),
      });
      throw patchError instanceof Error ? patchError : new Error(String(patchError));
    }
  }

  for (const [securityType, ids] of securityIdsByBackfillType) {
    try {
      await Securities.update({ securityType }, { where: { id: { [Op.in]: ids }, securityType: null } });
    } catch (error) {
      logger.error(
        {
          message: `[${label}] Failed to backfill securityType for ${ids.length} securities`,
          error: error as Error,
        },
        { code: 'SECURITY_TYPE_BACKFILL_FAILED' },
      );
    }
  }

  logger.info(
    `[${label}] Securities prices sync completed. Processed: ${result.totalProcessed}, Success: ${result.successfulUpdates}, Failed: ${result.failedUpdates}`,
  );

  // warn goes to Sentry; per-symbol misses alone stay at info by design, so
  // without this line a run losing much of the queue is invisible.
  if (
    result.failedUpdates >= FAILED_SYNC_WARN_MIN_SECURITIES &&
    result.failedUpdates >= result.totalProcessed * FAILED_SYNC_WARN_RATIO
  ) {
    logger.warn(
      `[${label}] ${result.failedUpdates}/${result.totalProcessed} securities failed price sync: ${result.errors
        .slice(0, 20)
        .map((e) => e.symbol ?? e.securityId)
        .join(', ')}`,
    );
  }

  return result;
};

/**
 * Daily sync for non-crypto securities (stocks, ETFs, etc.).
 *
 * Fetches the trailing `STOCKS_LOOKBACK_DAYS` window ending at yesterday and
 * stores one row per security per UTC day, anchored to midnight UTC of the
 * bar's own day. Held under a stocks-specific lock so it doesn't serialize
 * against the hourly crypto sync.
 */
export const securitiesPricesStocksDailySync = withLock('lock:sync:securities-prices:stocks', () => {
  const yesterdayMidnightUtc = startOfDayUtc(subDays(new Date(), 1));
  return securitiesPricesSyncImpl({
    assetClassWhere: { assetClass: { [Op.notIn]: [ASSET_CLASS.crypto] } },
    forDate: yesterdayMidnightUtc,
    fetchStartDate: subDays(yesterdayMidnightUtc, STOCKS_LOOKBACK_DAYS - 1),
    prepareBars: bucketByUtcDay,
    label: 'stocks-daily',
  });
});

/**
 * Hourly intraday sync for crypto holdings.
 *
 * Anchors each row to CoinGecko's `last_updated_at` (= `priceAsOf` on the
 * provider response). This lets multiple intraday snapshots coexist as
 * separate rows, while the unique `(securityId, date)` index naturally dedupes
 * when two cron runs see the same upstream timestamp (e.g. when CoinGecko
 * hasn't refreshed a low-volume coin between runs).
 *
 * Held under a crypto-specific lock so concurrent stock + crypto syncs don't
 * block each other.
 */
export const securitiesPricesCryptoSync = withLock('lock:sync:securities-prices:crypto', () =>
  securitiesPricesSyncImpl({
    assetClassWhere: { assetClass: { [Op.in]: [ASSET_CLASS.crypto] } },
    forDate: new Date(),
    prepareBars: (bars) => bars.map((bar) => ({ ...bar, date: bar.priceAsOf })),
    label: 'crypto-hourly',
  }),
);
