import UserExchangeRates, { toEffectiveDate } from '@models/user-exchange-rates.model';
import { getBaseCurrency } from '@models/users-currencies.model';
import { findCustomCurrencyCodes } from '@services/currencies/custom-currency-codes';
import { Op } from 'sequelize';

import type { CustomRateChange } from './recompute-scope';

/** A manual-rate write about to happen, read before it lands. */
interface PlannedRateChange {
  currencyCode: string;
  /** First day the change reaches; `null` when every day of the pair is affected. */
  from: string | null;
}

type RatePair = { baseCode: string; quoteCode: string; effectiveDate?: string };

/**
 * The days a manual rate write reaches, read before the write. A new day's rate after an earlier one
 * leaves valued rows alone; a replaced, past or removed rate reaches its days, and a manual ISO rate
 * into the base reaches every day of the custom currencies valued through it.
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
        planned.push({ currencyCode: pair.baseCode, from: null });
      }
      continue;
    }

    if (kind === 'remove') {
      planned.push({ currencyCode: pair.baseCode, from: pair.effectiveDate ?? null });
      continue;
    }

    const from = pair.effectiveDate ?? today;
    if (from >= today) {
      const existing = await UserExchangeRates.count({
        where: { userId, baseCode: pair.baseCode, effectiveDate: from },
      });
      const earlier = await UserExchangeRates.count({
        where: { userId, baseCode: pair.baseCode, effectiveDate: { [Op.lt]: from } },
      });
      if (existing === 0 && earlier > 0) continue;
    }

    planned.push({ currencyCode: pair.baseCode, from });
  }

  return planned;
};

/** Day of the next stored rate of the currency after `from`, in any quote. */
const findNextRateDay = async ({
  userId,
  change,
}: {
  userId: number;
  change: PlannedRateChange & { from: string };
}): Promise<string | null> => {
  const next = await UserExchangeRates.findOne({
    where: { userId, baseCode: change.currencyCode, effectiveDate: { [Op.gt]: change.from } },
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
  const changes: CustomRateChange[] = [];

  for (const change of planned) {
    const to =
      change.from === null ? null : await findNextRateDay({ userId, change: { ...change, from: change.from } });

    changes.push({ currencyCode: change.currencyCode, from: change.from, to });
  }

  return changes;
};
