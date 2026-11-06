import { getEarliestTransactionDate } from '../get-earliest-transaction-date';

/** Date (`yyyy-MM-dd`) of the user's oldest non-planned transaction, or null when there is none. */
export const getEarliestTransactionDateReport = async ({ userId }: { userId: number }) =>
  getEarliestTransactionDate({ userId });
