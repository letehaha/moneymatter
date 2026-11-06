import { getEarliestTransactionDateReport } from '@services/stats/reports/earliest-transaction-date.report';

import { defineTool } from '../define-tool';

export const getEarliestTransactionDateTool = defineTool({
  name: 'get_earliest_transaction_date',
  toolset: 'core',
  access: 'read',
  description:
    'Get the date (YYYY-MM-DD) of the first transaction on record, or null when there are none. Planned future transactions do not count. Use it to pick a start date for the report tools.',
  run: ({ userId }) => getEarliestTransactionDateReport({ userId }),
});
