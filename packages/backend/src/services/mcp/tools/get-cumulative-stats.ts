import { CUMULATIVE_METRICS } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { getCumulativeDataReport } from '@services/stats/reports/cumulative-data.report';
import { z } from 'zod';

import { defineTool } from '../define-tool';
import { assertStatsRangeOrder, statsRangeInput } from './stats-input';

const ids = ({ description }: { description: string }) => z.array(recordId()).optional().describe(description);

export const getCumulativeStatsTool = defineTool({
  name: 'get_cumulative_stats',
  toolset: 'core',
  access: 'read',
  description:
    'Get running totals of expenses, income or savings by month for a period, next to the period of the same length right before it, plus the percent change, in the base currency. Use it for "am I spending more than last quarter so far".',
  input: {
    ...statsRangeInput,
    metric: z.enum(CUMULATIVE_METRICS).describe('What to accumulate: expenses, income or savings'),
    accountId: recordId().optional().describe('Only this account'),
    accountIds: ids({ description: 'Only these accounts (wins over accountId)' }),
    payeeIds: ids({ description: 'Only these payees' }),
    excludedPayeeIds: ids({ description: 'Leave out these payees' }),
    tagIds: ids({ description: 'Only transactions with these tags' }),
    excludedTagIds: ids({ description: 'Leave out transactions with these tags' }),
    categoryIds: ids({ description: 'Only these categories (a parent includes its subcategories)' }),
    excludedCategoryIds: ids({ description: 'Leave out these categories (a parent hides its subcategories)' }),
  },
  run: ({ userId, args }) => {
    assertStatsRangeOrder({ from: args.from, to: args.to });

    return getCumulativeDataReport({
      userId,
      from: args.from,
      to: args.to,
      metric: args.metric,
      accountId: args.accountId,
      accountIds: args.accountIds,
      payeeIds: args.payeeIds,
      excludedPayeeIds: args.excludedPayeeIds,
      tagIds: args.tagIds,
      excludedTagIds: args.excludedTagIds,
      categoryIds: args.categoryIds,
      excludedCategoryIds: args.excludedCategoryIds,
    });
  },
});
