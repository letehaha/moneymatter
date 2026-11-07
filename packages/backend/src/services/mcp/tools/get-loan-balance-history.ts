import { recordId } from '@common/lib/zod/custom-types';
import { getLoanBalanceHistory } from '@services/loans/get-loan-balance-history.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';

const DEFAULT_LIMIT = 120;
const MAX_LIMIT = 500;

export const getLoanBalanceHistoryTool = defineTool({
  name: 'get_loan_balance_history',
  toolset: 'loans-vehicles',
  access: 'read',
  description:
    'The outstanding balance of a loan over time, in the loan currency: the opening balance followed by one end-of-day point per day that has payments, oldest first. amount is negative while debt is outstanding and 0 once settled. Returns { points, total }, total being the number of points before limit; when it is over the limit, the newest points are kept.',
  input: {
    loanId: recordId().describe('Loan ID (from get_loans)'),
    limit: z
      .number()
      .int()
      .positive()
      .max(MAX_LIMIT)
      .optional()
      .describe(`How many of the newest points to return, 1 to ${MAX_LIMIT} (default ${DEFAULT_LIMIT})`),
  },
  run: async ({ userId, args }) => {
    const series = await getLoanBalanceHistory({ userId, accountId: args.loanId });
    const limit = args.limit ?? DEFAULT_LIMIT;

    return { points: series.slice(-limit), total: series.length };
  },
});
