import type { TransactionGroupConflictDetails } from '@bt/shared/types';
import { ConflictError, ValidationError } from '@js/errors';
import TransactionGroupItems from '@models/transaction-group-items.model';
import TransactionGroups from '@models/transaction-groups.model';
import { countTransactions } from '@models/transactions-query';
import { Op } from 'sequelize';

/**
 * Validates that the given transaction IDs:
 * 1. All belong to the specified user
 * 2. None already belong to any group
 *
 * Throws ValidationError or ConflictError if validation fails.
 */
export async function validateTransactionsForGroup({
  transactionIds,
  userId,
}: {
  transactionIds: string[];
  userId: number;
}): Promise<void> {
  // Use count() instead of findAll() — we only need the count, not full rows.
  // Groups are a plain labelling device with no money semantics, so a plan is as
  // groupable as any other row and the count must see it, or valid ids read as invalid.
  const matchingCount = await countTransactions({
    where: {
      id: { [Op.in]: transactionIds },
    },
    planned: 'include',
    access: { creator: userId },
    balanceAdjustments: 'include',
  });

  if (matchingCount !== transactionIds.length) {
    throw new ValidationError({
      message: 'Some transaction IDs are invalid or do not belong to you.',
    });
  }

  const existingGroupItems = await TransactionGroupItems.findAll({
    where: {
      transactionId: { [Op.in]: transactionIds },
    },
    attributes: ['transactionId', 'groupId'],
  });

  if (existingGroupItems.length > 0) {
    const groups = await TransactionGroups.findAll({
      where: { userId, id: { [Op.in]: [...new Set(existingGroupItems.map((item) => item.groupId))] } },
      attributes: ['id', 'name'],
      order: [['name', 'ASC']],
    });

    throw new ConflictError({
      message: 'Some transactions already belong to a group.',
      details: {
        transactionIds: existingGroupItems.map((item) => item.transactionId),
        groups: groups.map(({ id, name }) => ({ id, name })),
      } satisfies TransactionGroupConflictDetails,
    });
  }
}
