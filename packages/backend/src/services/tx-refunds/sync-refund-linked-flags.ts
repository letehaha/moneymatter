import { updateTransactions } from '@models/transactions-query';
import { liveOrExternalTransactionSql, liveTransactionExistsSql } from '@models/transactions-query/deletion-where';
import { Op, type UpdateOptions, literal } from 'sequelize';

/**
 * Recomputes `Transactions.refundLinked` for the given ids from the links that actually exist.
 * A link counts only while its counterpart is live (or external), so a counterpart in the Trash
 * leaves this side unflagged.
 *
 * One purchase can carry several partial refunds, so dropping a single link says nothing about
 * whether the flag should go down. Every read path that nets refunds out of expenses starts from
 * this flag — `resolveRefundPairs`, `fetchTrackerRefundPairs` and the pivot equivalent only look up
 * links for transactions that carry it — so a flag cleared while a link survives makes that refund
 * stop netting and the expense report overstate.
 *
 * The new value is computed inside the UPDATE so Postgres re-evaluates it after taking the row
 * lock. Reading the links first and writing the result back would let a concurrent request insert
 * a link in the gap and have this one overwrite the flag it just set.
 *
 * No `userId` filter: callers pass ids they have already authorized, and the flag has exactly one
 * correct value per row regardless of who wrote it.
 */
export const syncRefundLinkedFlags = async ({
  transactionIds,
  ...options
}: { transactionIds: (string | null)[] } & Pick<UpdateOptions, 'transaction' | 'paranoid' | 'silent'>) => {
  const ids = [...new Set(transactionIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;

  await updateTransactions({
    ...options,
    values: {
      refundLinked: literal(`EXISTS (
        SELECT 1 FROM "RefundTransactions" r
        WHERE (r."refundTxId" = "Transactions".id
            AND ${liveOrExternalTransactionSql({ idColumnSql: 'r."originalTxId"' })})
          OR (r."originalTxId" = "Transactions".id
            AND ${liveTransactionExistsSql({ idColumnSql: 'r."refundTxId"' })})
      )`),
    },
    where: { id: { [Op.in]: ids } },
    planned: 'include',
    access: 'unscoped-internal',
    balanceAdjustments: 'include',
  });
};
