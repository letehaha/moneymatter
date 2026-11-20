import {
  TRANSACTION_GROUP_MAX_SIZE,
  TRANSACTION_GROUP_MIN_SIZE,
  type RecordId,
  type TransactionGroupSizeLimitDetails,
} from '@bt/shared/types';
import { ValidationError } from '@js/errors';
import TransactionGroupItems from '@models/transaction-group-items.model';
import TransactionGroups from '@models/transaction-groups.model';
import { withTransaction } from '@services/common/with-transaction';

import { INCLUDE_GROUP_TRANSACTIONS } from './constants';
import { resolveTransferPairs } from './resolve-transfer-pairs';
import { validateTransactionsForGroup } from './validate-transactions-for-group';

interface CreateTransactionGroupPayload {
  userId: number;
  name: string;
  note?: string | null;
  transactionIds: RecordId[];
}

export const createTransactionGroup = withTransaction(async (payload: CreateTransactionGroupPayload) => {
  const { userId, name, note, transactionIds } = payload;

  // Auto-include opposite sides of transfer pairs
  const expandedIds = await resolveTransferPairs({ transactionIds, userId });

  if (expandedIds.length < TRANSACTION_GROUP_MIN_SIZE) {
    throw new ValidationError({
      message: `A group must contain between ${TRANSACTION_GROUP_MIN_SIZE} and ${TRANSACTION_GROUP_MAX_SIZE} transactions.`,
    });
  }

  if (expandedIds.length > TRANSACTION_GROUP_MAX_SIZE) {
    throw new ValidationError({
      message: `A group must contain between ${TRANSACTION_GROUP_MIN_SIZE} and ${TRANSACTION_GROUP_MAX_SIZE} transactions.`,
      details: {
        maxSize: TRANSACTION_GROUP_MAX_SIZE,
        count: expandedIds.length,
      } satisfies TransactionGroupSizeLimitDetails,
    });
  }

  await validateTransactionsForGroup({ transactionIds: expandedIds, userId });

  const group = await TransactionGroups.create({
    userId,
    name,
    note: note ?? null,
  });

  const items = expandedIds.map((transactionId) => ({
    groupId: group.id,
    transactionId,
  }));

  await TransactionGroupItems.bulkCreate(items);

  // Reload with transactions
  const result = await TransactionGroups.findByPk(group.id, {
    include: [INCLUDE_GROUP_TRANSACTIONS],
  });

  return result!;
});
