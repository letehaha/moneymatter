import { CATEGORIZATION_SOURCE, RESOURCE_TYPES, SHARE_PERMISSIONS, isTwoLegTransfer } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import * as Transactions from '@models/transactions.model';
import { getUserDefaultCategory } from '@models/users.model';
import { canUserAccessResource } from '@services/sharing/auth/can-user-access-resource.service';
import { matchTransactionToSubscriptions } from '@services/subscriptions/matching-engine';

import { abortsTransaction } from '../create-transaction';
import { type UpdateTransactionParams } from '../types';

/** Does the edit change a field subscription matching reads? */
const changesMatchingFields = ({
  payload,
  prevData,
}: {
  payload: UpdateTransactionParams;
  prevData: Transactions.default;
}): boolean =>
  (payload.note !== undefined && payload.note !== prevData.note) ||
  (payload.amount !== undefined && !payload.amount.equals(prevData.amount)) ||
  (payload.accountId !== undefined && payload.accountId !== prevData.accountId) ||
  (payload.transactionType !== undefined && payload.transactionType !== prevData.transactionType) ||
  (payload.time !== undefined && payload.time.getTime() !== prevData.time.getTime());

/**
 * May a subscription match replace the row's category? Only a category nobody chose: the
 * default ("uncategorized") one, or one an automatic source set. A manual choice stays.
 */
const isReplaceableCategory = async ({
  categoryId,
  source,
  ownerUserId,
}: {
  categoryId: string;
  source: CATEGORIZATION_SOURCE | undefined;
  ownerUserId: number;
}): Promise<boolean> => {
  if (source) return source !== CATEGORIZATION_SOURCE.manual;

  return categoryId === (await getUserDefaultCategory({ id: ownerUserId }));
};

/**
 * Re-runs subscription matching for an edited row. A revoked recipient's subscriptions must
 * not reach a row on the owner's account, and a category the user chose is never overwritten
 * by the subscription's.
 */
export const matchEditedTransactionToSubscriptions = async ({
  transaction,
  payload,
  prevData,
  accountOwnerUserId,
}: {
  transaction: Transactions.default;
  payload: UpdateTransactionParams;
  prevData: Transactions.default;
  accountOwnerUserId: number;
}): Promise<void> => {
  if (
    !(changesMatchingFields({ payload, prevData }) || isTwoLegTransfer(prevData.transferNature)) ||
    isTwoLegTransfer(transaction.transferNature)
  ) {
    return;
  }

  try {
    const authorCanRead = await canUserAccessResource({
      userId: transaction.userId,
      resourceType: RESOURCE_TYPES.account,
      resourceId: transaction.accountId,
      requiredPermission: SHARE_PERMISSIONS.read,
    });

    if (!authorCanRead.granted) {
      logger.info(`Skipped subscription matching of ${transaction.id}: its author no longer reads the account`);
      return;
    }

    const matched = await matchTransactionToSubscriptions({
      transaction,
      userId: transaction.userId,
      preserveCategory:
        (payload.categoryId !== undefined && payload.categoryId !== prevData.categoryId) ||
        !(await isReplaceableCategory({
          categoryId: prevData.categoryId,
          source: prevData.categorizationMeta?.source,
          ownerUserId: accountOwnerUserId,
        })),
    });
    if (matched) await transaction.reload();
  } catch (error) {
    if (abortsTransaction(error)) throw error;
    logger.error({
      message: `Failed to match edited transaction ${transaction.id} to subscriptions`,
      error: error as Error,
    });
  }
};
