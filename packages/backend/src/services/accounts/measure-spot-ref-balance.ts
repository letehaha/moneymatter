import { Money } from '@common/types/money';
import { logger } from '@js/utils/logger';
import type Accounts from '@models/accounts.model';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';

/**
 * Spot-measure an account balance in the owner's base currency: native `amount`
 * converted at the latest rate (`calculateRefAmount` dated today, cache bypassed).
 *
 * Returns `null` when no rate reaches the pair (exotic currency, provider gap,
 * owner not connected). Callers keep their stored ref value and let the daily
 * rate-sync remeasure re-anchor it, so a native write never aborts on a missing
 * rate. Logs once under `ACCOUNT_REF_REMEASURE_FAILED`.
 */
export async function measureSpotRefBalance({
  userId,
  amount,
  baseCode,
  site,
}: {
  userId: number;
  amount: Money;
  baseCode: string;
  /** Names the calling write path in the failure log. */
  site: string;
}): Promise<Money | null> {
  try {
    return await calculateRefAmount({
      userId,
      definitionOwnerUserId: userId,
      amount,
      baseCode,
      date: new Date(),
      bypassCache: true,
    });
  } catch (error) {
    logger.error(
      {
        message: `Failed to measure spot ref balance (${site}); previous value kept; self-heals on next rate sync`,
        error: error as Error,
      },
      { code: 'ACCOUNT_REF_REMEASURE_FAILED', userId, baseCode },
    );
    return null;
  }
}

/** Same rate, date and cache rules as `measureSpotRefBalance`; `null` means rate unavailable, keep the stored value. */
export async function measureSpotRefCreditLimit({
  account,
  site,
}: {
  account: Pick<Accounts, 'userId' | 'creditLimit' | 'currencyCode'>;
  site: string;
}): Promise<Money | null> {
  if (account.creditLimit.isZero()) return Money.zero();
  return measureSpotRefBalance({
    userId: account.userId,
    amount: account.creditLimit,
    baseCode: account.currencyCode,
    site: `${site}:refCreditLimit`,
  });
}
