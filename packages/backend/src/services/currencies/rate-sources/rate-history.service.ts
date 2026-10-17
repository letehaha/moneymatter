import type { CurrencyRateHistoryResponse } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import type UserExchangeRates from '@models/user-exchange-rates.model';
import { toEffectiveDate } from '@models/user-exchange-rates.model';
import { getBaseCurrency } from '@models/users-currencies.model';
import { isSourceOwnedRateSource } from '@services/user-exchange-rate/resolve-custom-pair-rate';

import { countStoredCustomRates, findStoredCustomRate, findStoredPairRate, listStoredCustomRates } from './manual';
import { findHeldCurrency } from './set-rate-source.service';

type StoredRate = Pick<UserExchangeRates, 'quoteCode' | 'effectiveDate'>;

/**
 * The stored rate that values a custom code in the user's base currency today, as the first step of
 * `resolveCustomPairRate` picks it: none while the code follows a peg (it overrides every stored
 * row); for a manual code the exact pair to the base, if one is stored; otherwise the latest row in
 * whichever quote it was entered in.
 */
const findRateInForce = async ({
  userId,
  code,
  rateSource,
}: {
  userId: number;
  code: string;
  rateSource: string;
}): Promise<StoredRate | null> => {
  if (rateSource === 'peg') return null;

  const asOfDate = toEffectiveDate({ date: new Date() });

  if (!isSourceOwnedRateSource({ rateSource })) {
    const base = await getBaseCurrency({ userId });
    const exact = base
      ? await findStoredPairRate({ userId, baseCode: code, quoteCode: base.currencyCode, asOfDate })
      : null;
    if (exact) return exact;
  }

  return findStoredCustomRate({ userId, baseCode: code, asOfDate, excludedQuotes: [code] });
};

/**
 * One page of the user's stored rates for a custom currency, latest first. The synced sources write
 * one direction only (`code -> quote`), while the manual editor writes both, so the list holds the
 * rows whose base is the currency. `totalCount` comes with the first page only.
 */
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
    findRateInForce({ userId, code, rateSource: held.rateSource }),
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
