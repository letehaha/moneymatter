import { INVESTMENT_CONTRIBUTIONS_GRANULARITIES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { getInvestmentContributionsReport } from '@services/stats/reports/investment-contributions.report';
import { z } from 'zod';

import { defineTool } from '../define-tool';
import { assertStatsRangeOrder, statsRangeInput } from './stats-input';

export const getInvestmentContributionsTool = defineTool({
  name: 'get_investment_contributions',
  toolset: 'investments',
  access: 'read',
  description:
    'Get the money moved into portfolios (net of withdrawals) per period, in the base currency, with the split per portfolio and the net savings of the same period for comparison.',
  input: {
    ...statsRangeInput,
    granularity: z.enum(INVESTMENT_CONTRIBUTIONS_GRANULARITIES).describe('Period length: monthly, quarterly or yearly'),
    portfolioIds: z.array(recordId()).optional().describe('Only count these portfolios. Unknown ids are dropped.'),
  },
  run: ({ userId, args }) => {
    assertStatsRangeOrder({ from: args.from, to: args.to });

    return getInvestmentContributionsReport({
      userId,
      from: args.from,
      to: args.to,
      granularity: args.granularity,
      portfolioIds: args.portfolioIds,
    });
  },
});
