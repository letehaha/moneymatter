import type { RecordId } from '@bt/shared/types';
import { ValidationError } from '@js/errors';
import { findTransactions } from '@models/transactions-query';
import { serializeTransactions } from '@root/serializers/transactions.serializer';
import { Op } from 'sequelize';

import { withTransaction } from '../common/with-transaction';

const MAX_IDS = 50;

interface GetTransactionsByIdsParams {
  userId: number;
  ids: RecordId[];
}

/** Returns the requested transactions on accounts the caller can currently access; other ids are omitted. */
export const getTransactionsByIds = withTransaction(async ({ userId, ids }: GetTransactionsByIdsParams) => {
  if (ids.length > MAX_IDS) {
    throw new ValidationError({
      message: `Cannot fetch more than ${MAX_IDS} transactions at once`,
    });
  }

  if (ids.length === 0) {
    return [];
  }

  const transactions = await findTransactions({
    planned: { visibleTo: userId },
    access: { accessibleTo: userId },
    balanceAdjustments: 'include',
    completeness: 'all',
    where: { id: { [Op.in]: ids } },
  });

  return serializeTransactions(transactions);
});
