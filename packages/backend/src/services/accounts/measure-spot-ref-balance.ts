import { Money } from '@common/types/money';
import { logger } from '@js/utils/logger';
import { calculateRefAmountOrNull } from '@services/calculate-ref-amount.service';

/**
 * Spot-measure an account balance in the owner's base currency: native `amount`
 * converted at the latest rate (`calculateRefAmount` dated today, cache bypassed).
 *
 * - A `Money` is the measured value.
 * - `null` means the account is in a custom currency with no rate: it has no
 *   base-currency value, and the caller stores `null`.
 * - `undefined` means no rate reaches the pair (exotic currency, provider gap,
 *   owner not connected). Callers keep their stored ref value and let the daily
 *   rate-sync remeasure re-anchor it, so a native write never aborts on a missing
 *   rate. Logs once under `ACCOUNT_REF_REMEASURE_FAILED`.
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
}): Promise<Money | null | undefined> {
  try {
    return await calculateRefAmountOrNull({
      userId,
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
    return undefined;
  }
}
