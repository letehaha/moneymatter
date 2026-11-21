import type { UserExchangeRateSource } from '@bt/shared/types';
import { namespace } from '@models/connection';
import UserExchangeRates from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';
import { withTransaction } from '@services/common/with-transaction';
import { isDeepStrictEqual } from 'node:util';
import { Op } from 'sequelize';

import { isBaseCurrencyChangeLocked } from '../base-currency-lock';
import { recomputeCustomRefAmounts } from '../recompute-custom-ref-amounts.service';
import type { CustomRateChange } from '../recompute-scope';

/** One day's rate of a synced source: `day` is the UTC calendar day (`YYYY-MM-DD`). */
export interface SyncedDailyRate {
  day: string;
  rate: number;
}

/** The sources that write rates on their own; a rate the user set by hand is `manual`. */
type SyncedRateSource = Exclude<UserExchangeRateSource, 'manual'>;

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
 * again.
 *
 * A day the user set by hand keeps their rate. A day a synced source wrote before is replaced when
 * the price differs (a source the user switched from yields to the one in force). A rate for a new
 * day of a daily run leaves the rows valued before it as they are; a backfill (which writes days
 * that were valued with an earlier rate) values the rows of those days again. Days before the first
 * rate are valued with it, so a backfill that reaches past the first rate values every earlier day
 * again too.
 *
 * Nothing is written, and 0 comes back, when the user's base currency is being changed (the change
 * rewrites every converted amount, and the next run catches the rates up) or when the currency no
 * longer has the source and settings the rates were fetched with (the user changed them meanwhile,
 * and the rates belong to the old ones).
 */
export const storeSyncedRates = withTransaction(
  async ({
    userId,
    currencyCode,
    quoteCurrency,
    rates,
    kind,
    source,
    fetchedWith,
  }: {
    userId: number;
    currencyCode: string;
    quoteCurrency: string;
    rates: SyncedDailyRate[];
    /** `backfill` writes a series of days; `daily` writes the rate of a new day. */
    kind: 'backfill' | 'daily';
    source: SyncedRateSource;
    fetchedWith: FetchedWith;
  }): Promise<number> => {
    if (!rates.length) return 0;
    if (await isBaseCurrencyChangeLocked({ userId })) return 0;
    if (!(await isFetchStillCurrent({ userId, currencyCode, source, fetchedWith }))) return 0;

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
      } else if (known.source !== 'manual' && (Number(known.rate) !== rate || known.source !== source)) {
        // A manual edit of this day may have committed since the read above, so the write itself
        // leaves a manual row alone. The row takes the tag of the source that now owns its price.
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

    const written = [...added, ...replaced].toSorted();
    if (!written.length) return 0;

    const from = kind === 'backfill' ? written[0]! : replaced.toSorted()[0];
    if (from === undefined) return written.length;

    const earlierRate = await UserExchangeRates.findOne({
      where: { userId, baseCode: currencyCode, effectiveDate: { [Op.lt]: from } },
      attributes: ['effectiveDate'],
    });
    const changes: CustomRateChange[] = [{ currencyCode, from: earlierRate ? from : null, to: null }];

    await recomputeCustomRefAmounts({ userId, changes });

    return written.length;
  },
);
