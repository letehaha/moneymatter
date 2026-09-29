import type { RecordId } from '@bt/shared/types';
import { findTransactions } from '@models/transactions-query';
import { serializeTransaction, serializeTransactions } from '@root/serializers/transactions.serializer';
import { Op } from 'sequelize';

export const getReconciliationHistory = async ({ userId }: { userId: number }) => {
  const removed = await findTransactions({
    where: { deletedAt: { [Op.ne]: null } },
    paranoid: false,
    planned: 'include',
    access: { creator: userId },
    balanceAdjustments: 'include',
    completeness: 'all',
    order: [
      ['deletedAt', 'DESC'],
      ['time', 'DESC'],
    ],
  });

  const survivorIds = [...new Set(removed.map((row) => row.mergedIntoId).filter((id): id is RecordId => !!id))];
  const survivors = survivorIds.length
    ? await findTransactions({
        where: { id: { [Op.in]: survivorIds } },
        paranoid: false,
        planned: 'include',
        access: { creator: userId },
        balanceAdjustments: 'include',
        completeness: 'all',
      })
    : [];
  const survivorById = new Map(survivors.map((row) => [row.id, row]));

  // ponytail: same-millisecond actions collapse into one entry; add an event id column if that matters
  const events = Map.groupBy(removed, (row) => row.deletedAt!.toISOString());

  return [...events].map(([removedAt, rows]) => {
    const mergedIntoId = rows.find((row) => row.mergedIntoId)?.mergedIntoId;
    const survivor = mergedIntoId ? survivorById.get(mergedIntoId) : undefined;
    const base = { removedAt, transactions: serializeTransactions(rows) };

    return survivor
      ? { ...base, type: 'merge' as const, survivor: serializeTransaction(survivor) }
      : { ...base, type: 'remove' as const, survivor: null };
  });
};
