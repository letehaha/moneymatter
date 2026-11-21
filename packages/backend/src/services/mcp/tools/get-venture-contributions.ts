import { getVentureContributionsReport } from '@services/stats/reports/venture-contributions.report';

import { defineTool } from '../define-tool';
import { assertStatsRangeOrder, statsRangeInput } from './stats-input';

export const getVentureContributionsTool = defineTool({
  name: 'get_venture_contributions',
  toolset: 'ventures',
  access: 'read',
  description:
    'Get the net amount contributed to each venture deal in a date range, in the base currency. Each item has the deal id, its name and the amount.',
  input: { ...statsRangeInput },
  run: async ({ userId, args }) => {
    assertStatsRangeOrder({ from: args.from, to: args.to });

    return getVentureContributionsReport({ userId, from: args.from, to: args.to });
  },
});
