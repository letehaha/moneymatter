import { TRANSACTION_GROUP_MAX_SIZE, type RecordId, type TransactionGroupSizeLimitDetails } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { ValidationError } from '@js/errors';
import TransactionGroupItems from '@models/transaction-group-items.model';
import TransactionGroups from '@models/transaction-groups.model';
import { withTransaction } from '@services/common/with-transaction';
import { Op } from 'sequelize';

import { INCLUDE_GROUP_TRANSACTIONS } from './constants';
import { resolveTransferPairs } from './resolve-transfer-pairs';
import { validateTransactionsForGroup } from './validate-transactions-for-group';

interface AddTransactionsToGroupPayload {
  groupId: RecordId;
  userId: number;
  transactionIds: RecordId[];
}

export const addTransactionsToGroup = withTransaction(async (payload: AddTransactionsToGroupPayload) => {
  const { groupId, userId, transactionIds } = payload;

  await findOrThrowNotFound({
    query: TransactionGroups.findOne({
      where: { id: groupId, userId },
    }),
    message: 'Transaction group not found.',
  });

  // Auto-include opposite sides of transfer pairs
  const expandedIds = await resolveTransferPairs({ transactionIds, userId });

  // Filter out transactions already in this group to avoid conflicts
  const existingInGroup = await TransactionGroupItems.findAll({
    where: { groupId, transactionId: { [Op.in]: expandedIds } },
    attributes: ['transactionId'],
    raw: true,
  });
  const existingIds = new Set(existingInGroup.map((i) => i.transactionId as RecordId));
  const newIds = expandedIds.filter((id) => !existingIds.has(id));

  if (newIds.length === 0) {
    const result = await TransactionGroups.findByPk(groupId, {
      include: [INCLUDE_GROUP_TRANSACTIONS],
    });
    return result!;
  }

  await validateTransactionsForGroup({ transactionIds: newIds, userId });

  // Check group size limit
  const currentCount = await TransactionGroupItems.count({
    where: { groupId },
  });

  const resultingCount = currentCount + newIds.length;

  if (resultingCount > TRANSACTION_GROUP_MAX_SIZE) {
    throw new ValidationError({
      message: `Adding these transactions would exceed the maximum group size of ${TRANSACTION_GROUP_MAX_SIZE}.`,
      details: {
        maxSize: TRANSACTION_GROUP_MAX_SIZE,
        count: resultingCount,
      } satisfies TransactionGroupSizeLimitDetails,
    });
  }

  const items = newIds.map((transactionId) => ({
    groupId,
    transactionId,
  }));

  await TransactionGroupItems.bulkCreate(items, { ignoreDuplicates: true });

  // Reload with transactions
  const result = await TransactionGroups.findByPk(groupId, {
    include: [INCLUDE_GROUP_TRANSACTIONS],
  });

  return result!;
});
