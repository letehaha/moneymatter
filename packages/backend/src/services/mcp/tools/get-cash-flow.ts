import { recordId } from '@common/lib/zod/custom-types';
import { getCashFlowReport } from '@services/stats/reports/cash-flow.report';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const getCashFlowTool = defineTool({
  name: 'get_cash_flow',
  toolset: 'core',
  access: 'read',
  description:
    'Get income, expenses, and net cash flow for a period with configurable granularity (monthly/biweekly/weekly). Returns period-by-period breakdown plus totals with savings rate.',
  input: {
    startDate: z.string().describe('Period start date (ISO 8601). Required.'),
    endDate: z.string().describe('Period end date (ISO 8601). Required.'),
    granularity: z.enum(['monthly', 'biweekly', 'weekly']).optional().describe('Time granularity. Default: monthly'),
    accountId: recordId().optional().describe('Filter by specific account ID'),
    categoryIds: z.array(recordId()).optional().describe('Filter by category IDs'),
    alignToPayday: z
      .boolean()
      .optional()
      .describe('Cut periods at the configured payday instead of calendar months. Default: false'),
  },
  run: ({ userId, args }) =>
    getCashFlowReport({
      userId,
      from: args.startDate,
      to: args.endDate,
      granularity: args.granularity ?? 'monthly',
      accountId: args.accountId,
      categoryIds: args.categoryIds,
      alignToPayday: args.alignToPayday,
    }),
});
