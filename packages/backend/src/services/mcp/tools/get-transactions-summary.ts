import { getTransactionsSummary } from '@services/transactions/matching-transactions';

import { defineTool } from '../define-tool';
import { parseTransactionFilters, transactionFilterInput } from './transaction-filter-input';

export const getTransactionsSummaryTool = defineTool({
  name: 'get_transactions_summary',
  toolset: 'core',
  access: 'read',
  description:
    'Count and totals of the transactions that match the filters, in the base currency: income, expense, net and transfers. Takes the same filters as the transaction list and as bulk_delete_transactions, so it previews what a bulk delete would remove. No default date range: omit from and to for the whole history.',
  input: transactionFilterInput,
  run: ({ userId, args }) => getTransactionsSummary({ ...parseTransactionFilters({ filters: args }), userId }),
});
