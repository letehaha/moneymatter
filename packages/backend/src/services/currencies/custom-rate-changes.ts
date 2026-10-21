import UserExchangeRates, { toEffectiveDate } from '@models/user-exchange-rates.model';
import { getBaseCurrency } from '@models/users-currencies.model';
import { findCustomCurrencyCodes } from '@services/currencies/custom-currency-codes';
import { Op } from 'sequelize';

import type { CustomRateChange, RecomputeMode } from './recompute-scope';

/** A manual-rate write about to happen, read before it lands. */
interface PlannedRateChange {
  currencyCode: string;
  quoteCode: string;
  /** First day the change reaches; `null` when every day of the pair is affected. */
  from: string | null;
  mode: RecomputeMode;
}

type RatePair = { baseCode: string; quoteCode: string; effectiveDate?: string };

/**
 * The days a manual rate written for a custom currency reaches, read before the write.
 *
 * A rate for a day that has none yet and is not in the past is a new day's rate: it only fills rows
 * waiting for a rate. A rate that replaces one already stored, or that lands on a past day, changes
 * the effective rate of days that were valued under the earlier state, so those are valued again.
 * Removing a rate does the same, and removing a pair without naming a day reaches all of its days.
 *
 * A pair with a custom currency on its base side is a rate a transaction is valued with; the reverse
 * direction the rate editor stores beside every pair is not a change. A manual rate between two ISO
 * currencies that quotes the base currency is a change too: a custom currency pegged to (or quoted
 * in) the base side is worth its ISO rate, and a manual ISO rate applies to every day, so the change
 * has no start or end day. The planned entry names the ISO code; the recompute expands it to the
 * custom currencies behind it.
 */
export const planRateChanges = async ({
  userId,
  pairs,
  kind,
}: {
  userId: number;
  pairs: RatePair[];
  kind: 'edit' | 'remove';
}): Promise<PlannedRateChange[]> => {
  const customCodes = await findCustomCurrencyCodes({ codes: pairs.map((pair) => pair.baseCode) });
  const baseCurrency = await getBaseCurrency({ userId });
  const today = toEffectiveDate({ date: new Date() });
  const planned: PlannedRateChange[] = [];

  for (const pair of pairs) {
    if (!customCodes.has(pair.baseCode.toUpperCase())) {
      if (baseCurrency && pair.quoteCode === baseCurrency.currency.code) {
        planned.push({ currencyCode: pair.baseCode, quoteCode: pair.quoteCode, from: null, mode: 'recompute' });
      }
      continue;
    }

    if (kind === 'remove') {
      planned.push({
        currencyCode: pair.baseCode,
        quoteCode: pair.quoteCode,
        from: pair.effectiveDate ?? null,
        mode: 'recompute',
      });
      continue;
    }

    const from = pair.effectiveDate ?? today;
    const existing = await UserExchangeRates.count({
      where: { userId, baseCode: pair.baseCode, quoteCode: pair.quoteCode, effectiveDate: from },
    });

    planned.push({
      currencyCode: pair.baseCode,
      quoteCode: pair.quoteCode,
      from,
      mode: existing === 0 && from >= today ? 'fill' : 'recompute',
    });
  }

  return planned;
};

/**
 * Day of the next stored rate after `after`. A rate quoted in the user's base currency is an exact
 * pair, which keeps applying until the next row of that same pair; any other quote is a step of the
 * walk, which a row of any quote takes over from.
 */
const findNextRateDay = async ({
  userId,
  change,
  baseCurrencyCode,
}: {
  userId: number;
  change: PlannedRateChange & { from: string };
  baseCurrencyCode: string;
}): Promise<string | null> => {
  const next = await UserExchangeRates.findOne({
    where: {
      userId,
      baseCode: change.currencyCode,
      ...(change.quoteCode === baseCurrencyCode ? { quoteCode: change.quoteCode } : {}),
      effectiveDate: { [Op.gt]: change.from },
    },
    attributes: ['effectiveDate'],
    order: [['effectiveDate', 'ASC']],
    raw: true,
  });

  return next?.effectiveDate ?? null;
};

/** The planned changes with the day the new state of the rates ends, read after the write. */
export const resolveRateChanges = async ({
  userId,
  planned,
}: {
  userId: number;
  planned: PlannedRateChange[];
}): Promise<CustomRateChange[]> => {
  if (!planned.length) return [];

  const baseCurrency = await getBaseCurrency({ userId });
  if (!baseCurrency) return [];

  const changes: CustomRateChange[] = [];

  for (const change of planned) {
    const to =
      change.from === null
        ? null
        : await findNextRateDay({
            userId,
            change: { ...change, from: change.from },
            baseCurrencyCode: baseCurrency.currency.code,
          });

    changes.push({ currencyCode: change.currencyCode, from: change.from, to, mode: change.mode });
  }

  return changes;
};
