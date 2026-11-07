import { NET_WORTH_DRIVERS_GRANULARITIES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { getNetWorthDriversReport } from '@services/stats/reports/net-worth-drivers.report';
import { z } from 'zod';

import { defineTool } from '../define-tool';
import { assertStatsRangeOrder, statsRangeInput } from './stats-input';

export const getNetWorthDriversTool = defineTool({
  name: 'get_net_worth_drivers',
  toolset: 'core',
  access: 'read',
  description:
    'Explain what moved net worth, period by period, in the base currency: savings (income, expenses, net), investment growth (price effect, dividends, fees and taxes, per portfolio) and the holdings and cash values at the end of the period. A degraded field lists securities or currencies that could not be priced.',
  input: {
    ...statsRangeInput,
    granularity: z.enum(NET_WORTH_DRIVERS_GRANULARITIES).describe('Period length: monthly, quarterly or yearly'),
    portfolioIds: z
      .array(recordId())
      .optional()
      .describe('Scope the investment part to these portfolios. Savings stay user-wide. Unknown ids are dropped.'),
  },
  run: ({ userId, args }) => {
    assertStatsRangeOrder({ from: args.from, to: args.to });

    return getNetWorthDriversReport({
      userId,
      from: args.from,
      to: args.to,
      granularity: args.granularity,
      portfolioIds: args.portfolioIds,
    });
  },
});
