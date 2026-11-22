import type { CurrencyRateHistoryResponse } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { toEffectiveDate } from '@models/user-exchange-rates.model';

import { countStoredCustomRates, findStoredCustomRate, listStoredCustomRates } from './manual';
import { findHeldCurrency } from './set-rate-source.service';

/** One page of the user's stored rates for a custom currency, latest first; `totalCount` on the first page only. */
export const listCurrencyRateHistory = async ({
  userId,
  code,
  limit,
  offset,
}: {
  userId: number;
  code: string;
  limit: number;
  offset: number;
}): Promise<CurrencyRateHistoryResponse> => {
  const held = await findHeldCurrency({ userId, code });

  // An ISO pair has one undated rate, listed with the other ISO rates.
  if (!held.currency.isCustom) {
    throw new ValidationError({ message: t({ key: 'currencies.rateHistoryIsoNotAllowed', variables: { code } }) });
  }

  const [rows, inForce, totalCount] = await Promise.all([
    listStoredCustomRates({ userId, baseCode: code, limit, offset }),
    // A peg prices the currency on its own, so no stored rate is in force while it runs.
    held.rateSource === 'peg'
      ? Promise.resolve(null)
      : findStoredCustomRate({ userId, baseCode: code, asOfDate: toEffectiveDate({ date: new Date() }) }),
    offset === 0 ? countStoredCustomRates({ userId, baseCode: code }) : Promise.resolve(null),
  ]);

  return {
    items: rows.map((row) => ({
      quoteCode: row.quoteCode,
      rate: Number(row.rate),
      effectiveDate: row.effectiveDate,
      source: row.source,
      writtenAt: row.date.toISOString(),
      isInForce: inForce?.quoteCode === row.quoteCode && inForce.effectiveDate === row.effectiveDate,
    })),
    totalCount,
  };
};
