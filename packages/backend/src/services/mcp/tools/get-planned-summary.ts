import { getPlannedSummary } from '@services/transactions/get-planned-summary';

import { defineTool } from '../define-tool';

export const getPlannedSummaryTool = defineTool({
  name: 'get_planned_summary',
  toolset: 'subscriptions',
  access: 'read',
  description:
    'Totals of the planned (upcoming, not yet confirmed) transactions per account and currency: plannedDelta in the account currency, refPlannedDelta in the base currency, the number of plans and the latest plan date. An expense counts negative. Use search_transactions with isPlanned to list the plans themselves.',
  run: ({ userId }) => getPlannedSummary({ userId }),
});
