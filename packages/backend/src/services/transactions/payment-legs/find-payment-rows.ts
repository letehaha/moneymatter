import { type FindTransactionsOptions, findTransactions } from '@models/transactions-query';

/** Reads a payment's rows whatever their kind or account, so callers must scope by ids or `paymentParentId`. */
export const findPaymentRows = (
  query: Omit<FindTransactionsOptions, 'planned' | 'access' | 'balanceAdjustments' | 'completeness'>,
) =>
  findTransactions({
    ...query,
    planned: 'include',
    access: 'unscoped-internal',
    balanceAdjustments: 'include',
    completeness: 'all',
  });
