import type { UserExchangeRateSource } from '@bt/shared/types';
import { namespace } from '@models/connection';
import UserExchangeRates from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';
import { withTransaction } from '@services/common/with-transaction';
import { isDeepStrictEqual } from 'node:util';
import { Op } from 'sequelize';

import { isBaseCurrencyChangeLocked } from '../base-currency-lock';
import { recomputeCustomRefAmounts } from '../recompute-custom-ref-amounts.service';

/** One day's rate of a synced source: `day` is the UTC calendar day (`YYYY-MM-DD`). */
export interface SyncedDailyRate {
  day: string;
  rate: number;
}

/** The sources that write rates on their own; the user's rates are `manual`, the creation rate `initial`. */
type SyncedRateSource = Exclude<UserExchangeRateSource, 'manual' | 'initial'>;

/** The saved settings a fetch was made with: the rates are stored only while the currency still has them. */
export interface FetchedWith {
  rateSourceConfig: unknown;
  /** Given for an `http` source, whose headers are part of the request; left out when they are not. */
  rateSourceHeadersEncrypted?: string | null;
}

/**
 * Locks the user's currency row and says whether it still runs `source` with the settings the rates
 * were fetched with. A save of the source holds the same row until it commits, so a fetch that
 * overlapped it waits and then finds the new settings.
 */
const isFetchStillCurrent = async ({
  userId,
  currencyCode,
  source,
  fetchedWith,
}: {
  userId: number;
  currencyCode: string;
  source: SyncedRateSource;
  fetchedWith: FetchedWith;
}): Promise<boolean> => {
  const transaction = namespace.get('transaction');
  const held = await UsersCurrencies.unscoped().findOne({
    where: { userId, currencyCode },
    attributes: ['rateSource', 'rateSourceConfig', 'rateSourceHeadersEncrypted'],
    transaction,
    lock: transaction?.LOCK.UPDATE,
    raw: true,
  });

  return (
    held?.rateSource === source &&
    isDeepStrictEqual(held.rateSourceConfig, fetchedWith.rateSourceConfig) &&
    (fetchedWith.rateSourceHeadersEncrypted === undefined ||
      held.rateSourceHeadersEncrypted === fetchedWith.rateSourceHeadersEncrypted)
  );
};

/**
 * Writes the rates a synced source fetched for one user's currency and values the rows they reach
 * again. A currency holds one rate per day, in whatever quote.
 *
 * A day that has a `manual` rate keeps it. Any other rate of a day (the creation rate, or a synced
 * one in this or another quote) gives way to the fetched one. A rate for a new day of a daily run
 * leaves the rows valued before it as they are; a backfill values the rows of the days it writes
 * again, and every day before them when it reaches past the first rate.
 *
 * Nothing is written, and 0 comes back, when the user's base currency is being changed or when the
 * currency no longer has the source and settings the rates were fetched with.
 */
export const storeSyncedRates = withTransaction(
  async ({
    userId,
    currencyCode,
    quoteCurrency,
    rates,
    kind,
    revalue = true,
    source,
    fetchedWith,
  }: {
    userId: number;
    currencyCode: string;
    quoteCurrency: string;
    rates: SyncedDailyRate[];
    /** `backfill` writes a series of days; `daily` writes the rate of a new day. */
    kind: 'backfill' | 'daily';
    /** `false` when the caller values the currency's rows again itself. */
    revalue?: boolean;
    source: SyncedRateSource;
    fetchedWith: FetchedWith;
  }): Promise<number> => {
    if (!rates.length) return 0;
    if (await isBaseCurrencyChangeLocked({ userId })) return 0;
    if (!(await isFetchStillCurrent({ userId, currencyCode, source, fetchedWith }))) return 0;

    const existing = await UserExchangeRates.findAll({
      where: { userId, baseCode: currencyCode, effectiveDate: { [Op.in]: rates.map((rate) => rate.day) } },
    });
    const existingByDay = Map.groupBy(existing, (row) => row.effectiveDate);

    const replaced: string[] = [];
    const otherQuoteDays: string[] = [];
    const created: SyncedDailyRate[] = [];

    for (const { day, rate } of rates) {
      const rows = existingByDay.get(day) ?? [];
      if (rows.some((row) => row.source === 'manual')) continue;

      const known = rows.find((row) => row.quoteCode === quoteCurrency);
      if (rows.some((row) => row !== known)) otherQuoteDays.push(day);

      if (!known) {
        created.push({ day, rate });
      } else if (Number(known.rate) !== rate || known.source !== source) {
        // A manual edit of this day may have committed since the read above, so the write itself
        // leaves a manual row alone.
        const [updated] = await UserExchangeRates.update(
          { rate, source },
          {
            where: {
              userId,
              baseCode: currencyCode,
              quoteCode: quoteCurrency,
              effectiveDate: day,
              source: { [Op.ne]: 'manual' },
            },
          },
        );
        if (updated && Number(known.rate) !== rate) replaced.push(day);
      }
    }

    if (otherQuoteDays.length) {
      await UserExchangeRates.destroy({
        where: {
          userId,
          baseCode: currencyCode,
          quoteCode: { [Op.ne]: quoteCurrency },
          effectiveDate: { [Op.in]: otherQuoteDays },
          source: { [Op.ne]: 'manual' },
        },
      });
    }

    if (created.length) {
      await UserExchangeRates.bulkCreate(
        created.map(({ day, rate }) => ({
          userId,
          baseCode: currencyCode,
          quoteCode: quoteCurrency,
          rate,
          effectiveDate: day,
          source,
        })),
      );
    }

    const changedDays = [...replaced, ...otherQuoteDays];
    const written = [...new Set([...created.map(({ day }) => day), ...changedDays])].toSorted();
    if (!written.length) return 0;
    if (!revalue) return written.length;

    const from = kind === 'backfill' ? written[0]! : changedDays.toSorted()[0];
    if (from !== undefined) await recomputeCustomRefAmounts({ userId, changes: [{ currencyCode, from, to: null }] });

    return written.length;
  },
);
