import type { UserExchangeRateSource } from '@bt/shared/types';
import UserExchangeRates from '@models/user-exchange-rates.model';
import { withTransaction } from '@services/common/with-transaction';
import { Op } from 'sequelize';

import { recomputeCustomRefAmounts } from '../recompute-custom-ref-amounts.service';
import type { CustomRateChange } from '../recompute-scope';

/** One day's rate of a synced source: `day` is the UTC calendar day (`YYYY-MM-DD`). */
export interface SyncedDailyRate {
  day: string;
  rate: number;
}

/** The sources that write rates on their own; a rate the user set by hand is `manual`. */
export type SyncedRateSource = Exclude<UserExchangeRateSource, 'manual'>;

/**
 * Writes the rates a synced source fetched for one user's currency and values the rows they reach
 * again.
 *
 * A day the user set by hand keeps their rate. A day a synced source wrote before is replaced when
 * the price differs (a source the user switched from yields to the one in force). A rate for a day
 * that had none is new: when it is today's it only fills rows waiting for a rate, and a backfill
 * (which writes days that may have been valued with an earlier rate) values the rows of those days
 * again.
 */
export const storeSyncedRates = withTransaction(
  async ({
    userId,
    currencyCode,
    quoteCurrency,
    rates,
    kind,
    source,
  }: {
    userId: number;
    currencyCode: string;
    quoteCurrency: string;
    rates: SyncedDailyRate[];
    /** `backfill` writes a series of days; `daily` writes the rate of a new day. */
    kind: 'backfill' | 'daily';
    source: SyncedRateSource;
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
      } else if (known.source !== 'manual' && Number(known.rate) !== rate) {
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
          source,
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
