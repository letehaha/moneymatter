import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import Accounts from '@models/accounts.model';
import type Currencies from '@models/currencies.model';
import UsersCurrenciesModel, * as UsersCurrencies from '@models/users-currencies.model';
import { withTransaction } from '@services/common/with-transaction';
import { ensureUserCurrencyConnected } from '@services/sharing/auth/ensure-currency-connected.service';
import { setDefaultUserCurrency } from '@services/user.service';
import { Op } from 'sequelize';

import { getOwnCustomCurrencyCodes } from './assert-currency-codes-visible';

// Picks a currency to adopt as the user's base/default currency when none is
// set yet. Accounts and UsersCurrencies rows carry time-ordered UUIDv7 ids, so
// ordering by id ascending yields the oldest row. Priority, strongest signal
// first:
//   1. the user's oldest account currency (their primary money context)
//   2. their oldest already-connected currency
//   3. the caller-provided fallback currency (a domain-specific hint, e.g. a
//      subscription's expected currency)
// Returns null only when no signal is available at all.
const resolveBaseCurrencyCode = async ({
  userId,
  fallbackCurrencyCode,
}: {
  userId: number;
  fallbackCurrencyCode?: string;
}): Promise<string | null> => {
  // A custom currency cannot be the base: it has no market rates to convert through.
  const customCodes = await getOwnCustomCurrencyCodes({ userId });
  const notCustom = customCodes.length ? { currencyCode: { [Op.notIn]: customCodes } } : {};

  const oldestAccount = await Accounts.findOne({
    where: { userId, ...notCustom },
    order: [['id', 'ASC']],
    attributes: ['currencyCode'],
    raw: true,
  });
  if (oldestAccount?.currencyCode) return oldestAccount.currencyCode;

  const oldestConnectedCurrency = await UsersCurrencies.default.findOne({
    where: { userId, ...notCustom },
    order: [['id', 'ASC']],
    attributes: ['currencyCode'],
    raw: true,
  });
  if (oldestConnectedCurrency?.currencyCode) return oldestConnectedCurrency.currencyCode;

  return fallbackCurrencyCode ?? null;
};

const ensureUserBaseCurrencyImpl = async ({
  userId,
  fallbackCurrencyCode,
}: {
  userId: number;
  fallbackCurrencyCode?: string;
}): Promise<UsersCurrenciesModel & { currency: Currencies }> => {
  const existing = await UsersCurrencies.getCurrency({ userId, isDefaultCurrency: true });
  if (existing?.currency) return existing;

  // A user with no base currency row cannot have amounts converted into a
  // reporting currency. This is a legacy state: some flows link a currency as a
  // NON-default row and never establish a base. Self-heal by adopting one from
  // the user's existing data instead of failing: ensure the picked currency is
  // connected via ensureUserCurrencyConnected, then promote the connected row
  // through setDefaultUserCurrency (which clears any other default and restamps
  // system-transaction refCurrency). Both are plain awaited calls, so they
  // participate in this service's ambient transaction and roll back together on
  // failure.
  const healedCurrencyCode = await resolveBaseCurrencyCode({ userId, fallbackCurrencyCode });

  if (!healedCurrencyCode) {
    // NOTE: this i18n key is subscriptions-flavored; kept as-is because a rename
    // requires locale-file changes handled separately. A generic key is desirable.
    throw new ValidationError({
      message: t({ key: 'subscriptions.summaryBaseCurrencyNotSet' }),
    });
  }

  const connectedCurrency = await ensureUserCurrencyConnected({
    userId,
    currencyCode: healedCurrencyCode,
  });
  await setDefaultUserCurrency({ userId, currencyCode: connectedCurrency.currencyCode });

  const healed = await UsersCurrencies.getCurrency({ userId, isDefaultCurrency: true });

  // The heal above sets a default currency; this guard narrows the type and
  // guards the impossible case where the write did not surface a row.
  if (!healed?.currency) {
    throw new ValidationError({
      message: t({ key: 'subscriptions.summaryBaseCurrencyNotSet' }),
    });
  }

  return healed;
};

/**
 * Get the user's base (default) currency row, self-healing a missing base
 * instead of failing. Returns the UsersCurrencies row with its Currencies
 * include, so callers can read `.currency.code` — the same shape as
 * `UsersCurrencies.getCurrency({ userId, isDefaultCurrency: true })`.
 *
 * Fast path: return the existing default-currency row when present. Otherwise
 * adopt a base from the user's own data (oldest account currency, then oldest
 * connected currency, then the caller-provided `fallbackCurrencyCode`), connect
 * it and promote it to default. Throws a ValidationError only when there is no
 * signal to heal from.
 *
 * withTransaction-wrapped: the connect + promote writes are atomic with the
 * caller's surrounding transaction.
 */
export const ensureUserBaseCurrency = withTransaction(ensureUserBaseCurrencyImpl);
