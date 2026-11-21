import { NET_WORTH_HISTORY_GRANULARITIES } from '@bt/shared/types';
import { getNetWorthHistoryReport } from '@services/stats/reports/net-worth-history.report';
import { z } from 'zod';

import { defineTool } from '../define-tool';
import { assertStatsRangeOrder, statsRangeInput } from './stats-input';

export const getNetWorthHistoryTool = defineTool({
  name: 'get_net_worth_history',
  toolset: 'core',
  access: 'read',
  description:
    'Get net worth over time as points, each with assets by kind (cash, investments, vehicles, ventures), liabilities by kind (credit-card, loan, overdraft) and the net worth, in the base currency. Subtracts credit limits when the includeCreditLimitInStats setting is on. A degraded field lists securities or currencies that could not be priced.',
  input: {
    ...statsRangeInput,
    granularity: z
      .enum(NET_WORTH_HISTORY_GRANULARITIES)
      .describe('Spacing of the points: weekly, monthly, quarterly or yearly'),
  },
  run: async ({ userId, args }) => {
    assertStatsRangeOrder({ from: args.from, to: args.to });

    return getNetWorthHistoryReport({
      userId,
      from: args.from,
      to: args.to,
      granularity: args.granularity,
    });
  },
});
