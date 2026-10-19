import { Money } from '@common/types/money';
import { NotFoundError } from '@js/errors';
import { logger } from '@js/utils';
import Accounts from '@models/accounts.model';
import Balances from '@models/balances.model';
import Properties from '@models/properties.model';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';
import { withTransaction } from '@services/common/with-transaction';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';
import { parseISO } from 'date-fns';

import { computePropertyValue } from './compute-property-value';

/**
 * Property values drift far slower than vehicle values, so the cache window is
 * wider than the vehicles' 7 days — a month of staleness is under a third of a
 * percent at a typical rate, and it keeps the accounts-list refresh cheap.
 */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface RefreshSingleParams {
  propertyId: string;
  force?: boolean;
  asOf?: Date;
}

interface RefreshSingleResult {
  value: Money;
  refValue: Money;
  refreshed: boolean;
}

/**
 * Recompute the projected value of a property if its cache is stale, and persist
 * the result on the underlying Account row + today's Balances row.
 *
 * Lazy by design — no background cron. Callers (account list, property detail,
 * stats) invoke this; if `valueLastComputedAt` is within the TTL, this returns
 * the cached value cheaply. When `force = true` (e.g. after changing the rate),
 * bypasses the cache.
 */
const refreshPropertyValueIfStaleImpl = async ({
  propertyId,
  force = false,
  asOf,
}: RefreshSingleParams): Promise<RefreshSingleResult> => {
  const property = await Properties.findByPk(propertyId, { include: [{ model: Accounts, as: 'account' }] });

  if (!property) {
    throw new NotFoundError({ message: 'Property not found' });
  }

  const account = property.account;
  const now = asOf ?? new Date();

  // While a base-currency recalculation holds the user's lock it is rewriting
  // every ref* amount; recomputing and persisting a fresh refValue here would
  // race that migration. Serve the stored value untouched, exactly like a cache
  // hit — the next lazy read after the lock clears refreshes.
  if (await isBaseCurrencyChangeLocked({ userId: property.userId })) {
    return {
      value: account.currentBalance,
      refValue: account.refCurrentBalance,
      refreshed: false,
    };
  }

  const cacheValid =
    !force &&
    property.valueLastComputedAt !== null &&
    now.getTime() - new Date(property.valueLastComputedAt).getTime() < CACHE_TTL_MS;

  if (cacheValid) {
    return {
      value: account.currentBalance,
      refValue: account.refCurrentBalance,
      refreshed: false,
    };
  }

  const hasAnchor = property.valueAnchor !== null && property.valueAnchorDate !== null;
  const anchorValue = hasAnchor ? property.valueAnchor! : property.purchasePrice;
  const anchorDateString = hasAnchor ? property.valueAnchorDate! : property.purchaseDate;

  const newValue = computePropertyValue({
    anchorValue,
    anchorDate: parseISO(anchorDateString),
    asOf: now,
    annualRatePct: Number(property.annualAppreciationRatePct),
  });

  const newRefValue = await calculateRefAmount({
    userId: property.userId,
    amount: newValue,
    baseCode: account.currencyCode,
    date: now,
  });

  await account.update({
    currentBalance: newValue,
    refCurrentBalance: newRefValue,
  });

  await Balances.updateAccountBalance({
    accountId: account.id,
    date: now,
    refBalance: newRefValue,
  });

  await property.update({ valueLastComputedAt: now });

  return { value: newValue, refValue: newRefValue, refreshed: true };
};

export const refreshPropertyValueIfStale = withTransaction(refreshPropertyValueIfStaleImpl);

interface RefreshBulkParams {
  userId: number;
  force?: boolean;
  asOf?: Date;
}

/**
 * Bulk variant — refresh every property for a user that is over the TTL. Called
 * from the accounts list endpoint so values are fresh in the response.
 *
 * Each per-property refresh runs in its own transaction (via the wrapped
 * `refreshPropertyValueIfStale`) so a failure on one doesn't roll back the
 * successful refreshes that came before it. Errors are logged but not thrown —
 * the caller's response succeeds with whatever values were freshable.
 */
export const refreshStalePropertyValuesForUser = async ({
  userId,
  force = false,
  asOf,
}: RefreshBulkParams): Promise<{ refreshedCount: number }> => {
  if (await isBaseCurrencyChangeLocked({ userId })) {
    return { refreshedCount: 0 };
  }

  const properties = await Properties.findAll({
    where: { userId },
    attributes: ['id', 'valueLastComputedAt'],
  });

  if (!properties.length) {
    return { refreshedCount: 0 };
  }

  const now = asOf ?? new Date();
  let refreshedCount = 0;

  for (const property of properties) {
    const cacheValid =
      !force &&
      property.valueLastComputedAt !== null &&
      now.getTime() - new Date(property.valueLastComputedAt).getTime() < CACHE_TTL_MS;

    if (cacheValid) continue;

    try {
      await refreshPropertyValueIfStale({ propertyId: property.id, force, asOf });
      refreshedCount += 1;
    } catch (err) {
      logger.warn(`Failed to refresh property value during bulk refresh`, {
        userId,
        propertyId: property.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { refreshedCount };
};
