import { Money } from '@common/types/money';
import { connection } from '@models/connection';
import { QueryTypes } from 'sequelize';

interface RefundedTotalRow {
  originalTxId: string;
  splitId: string | null;
  total: string;
}

type WithRefundedAmount<T> = T & { refundedAmount?: Money };

/**
 * Sets `refundedAmount` on each transaction (and each loaded split): the same-currency refund
 * shares linked to it. The transaction value is the total over all its links; each split carries its own part.
 */
export const attachRefundedAmounts = async <T extends { id: string; splits?: { id: string }[] }>({
  transactions,
}: {
  transactions: T[];
}): Promise<void> => {
  if (!transactions.length) return;

  const rows: RefundedTotalRow[] = await connection.sequelize.query(
    `
    SELECT l."originalTxId", l."splitId", SUM(COALESCE(l.amount, r.amount)) AS total
    FROM "RefundTransactions" l
    JOIN real_transactions r ON r.id = l."refundTxId"
    JOIN real_transactions o ON o.id = l."originalTxId"
    WHERE l."originalTxId" IN (:ids) AND r."currencyCode" = o."currencyCode"
    GROUP BY l."originalTxId", l."splitId"
    `,
    { type: QueryTypes.SELECT, replacements: { ids: transactions.map((tx) => tx.id) } },
  );

  for (const tx of transactions) {
    const txRows = rows.filter((row) => row.originalTxId === tx.id);
    const sum = (list: RefundedTotalRow[]) => Money.sum(list.map((row) => Money.fromCents(Number(row.total))));

    (tx as WithRefundedAmount<T>).refundedAmount = sum(txRows);
    for (const split of tx.splits ?? []) {
      (split as WithRefundedAmount<typeof split>).refundedAmount = sum(
        txRows.filter((row) => row.splitId === split.id),
      );
    }
  }
};
