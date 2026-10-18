import type { TransactionApiResponse } from '@root/serializers/transactions.serializer';
import { slimTransactionsForMcp } from '@services/mcp/serializers';
import { getPayeeNames } from '@services/payees/get-payee-names';

/**
 * Transactions as an assistant reads them, each with its payee. One name lookup serves the
 * whole page, so every tool that returns transactions goes through here.
 */
export async function presentTransactions({
  userId,
  transactions,
}: {
  userId: number;
  transactions: TransactionApiResponse[];
}) {
  const payeeIds = [...new Set(transactions.flatMap((tx) => (tx.payeeId ? [tx.payeeId] : [])))];
  const payeeNames = await getPayeeNames({ userId, payeeIds });

  return slimTransactionsForMcp({ transactions, payeeNames });
}
