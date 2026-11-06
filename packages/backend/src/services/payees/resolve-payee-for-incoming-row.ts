import { logger } from '@js/utils/logger';
import { getUserSettings } from '@services/user-settings/get-user-settings';

import { isDeadlockError } from '../common/retry-on-deadlock';
import { runInSavepoint } from '../common/run-in-savepoint';
import { resolvePayeeForRawMerchant } from './extraction.service';

/**
 * Payee resolution for a row arriving from a bank/provider: the dedicated merchant field
 * wins, and the note is consulted only when the account owner opted into
 * `payeeExtractionUsesDescription`. Linking is best-effort — resolution writes (promotion,
 * alias, backfill) can lose UNIQUE races against a concurrent sync, so the savepoint scopes
 * such a failure and leaves the caller's transaction usable.
 */
export const resolvePayeeForIncomingRow = async ({
  ownerUserId,
  rawMerchantName,
  note,
  failureLogMessage,
  logContext,
}: {
  ownerUserId: number;
  rawMerchantName?: string | null;
  note?: string | null;
  failureLogMessage: string;
  logContext?: Record<string, unknown>;
}): Promise<string | null> => {
  let effectiveRawMerchant = rawMerchantName;

  if (!effectiveRawMerchant && note) {
    const settings = await getUserSettings({ userId: ownerUserId });
    if (settings.payeeExtractionUsesDescription) {
      effectiveRawMerchant = note;
    }
  }

  if (!effectiveRawMerchant) return null;

  try {
    const extraction = await runInSavepoint(() =>
      resolvePayeeForRawMerchant({ userId: ownerUserId, rawMerchantName: effectiveRawMerchant }),
    );
    return extraction.payeeId;
  } catch (error) {
    // Rolling back to the savepoint keeps this transaction's earlier locks, so the other side
    // stays blocked on us; only aborting the whole transaction lets the caller retry it.
    if (isDeadlockError(error)) throw error;
    logger.error(
      {
        message: failureLogMessage,
        error: error as Error,
      },
      { ...logContext, rawMerchantName: effectiveRawMerchant },
    );
    return null;
  }
};
