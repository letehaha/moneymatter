import { TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { logger } from '@js/utils/logger';
import Transactions from '@models/transactions.model';

import { isDeadlockError } from '../../common/retry-on-deadlock';
import { runInSavepoint } from '../../common/run-in-savepoint';
import { findPlannedMatch } from './find-planned-match';
import { type IncomingTransactionData, mergeIntoPlanned } from './merge-into-planned';

export { accountHasPlannedRows, selectAccountsWithPlannedRows } from './find-planned-match';

/**
 * Find the planned row an incoming bank/import transaction confirms and merge the bank's
 * data into it. Returns `null` when nothing matched or the merge failed, in which case the
 * caller creates the bank row normally and nothing is lost.
 */
export const tryMergeIntoPlanned = async ({
  accountId,
  amount,
  transactionType,
  currencyCode,
  incoming,
}: {
  accountId: string;
  amount: Money;
  transactionType: TRANSACTION_TYPES;
  currencyCode: string;
  incoming: IncomingTransactionData;
}): Promise<Transactions | null> => {
  const planned = await findPlannedMatch({
    accountId,
    amount,
    transactionType,
    currencyCode,
    time: incoming.time,
  });

  if (!planned) return null;

  try {
    // The savepoint is what makes the fallback safe: the merge flips the plan to real partway
    // through, and without a scoped rollback a later throw would leave that flip in place while
    // the caller adds a second row for the same charge.
    const merged = await runInSavepoint(() => mergeIntoPlanned({ planned, incoming }));

    logger.info('Merged an incoming transaction into a planned one', {
      transactionId: merged.id,
      accountId,
      originalId: incoming.originalId,
    });

    return merged;
  } catch (error) {
    // The savepoint rollback keeps the outer transaction's locks, so a deadlock would recur.
    if (isDeadlockError(error)) throw error;
    logger.error(
      {
        message: 'Planned-transaction merge failed; creating the incoming transaction normally',
        error: error as Error,
      },
      {
        accountId,
        originalId: incoming.originalId ?? null,
        plannedTransactionId: planned.id,
      },
    );
    return null;
  }
};
