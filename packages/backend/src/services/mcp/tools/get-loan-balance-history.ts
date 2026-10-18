import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getLoanBalanceHistory } from '@services/loans/get-loan-balance-history.service';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';

const DEFAULT_LIMIT = 120;
const MAX_LIMIT = 500;

const inputSchema = {
  loanId: recordId().describe('Loan ID (from get_loans)'),
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .optional()
    .describe(`How many of the newest points to return, 1 to ${MAX_LIMIT} (default ${DEFAULT_LIMIT})`),
};

export function registerGetLoanBalanceHistory(server: McpServer) {
  server.registerTool(
    'get_loan_balance_history',
    {
      description:
        'The outstanding balance of a loan over time, in the loan currency: the opening balance followed by one end-of-day point per day that has payments, oldest first. amount is negative while debt is outstanding and 0 once settled. Returns { points, total }, total being the number of points before limit; when it is over the limit, the newest points are kept.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_loan_balance_history', clientId: extra.authInfo?.clientId });

      const series = await getLoanBalanceHistory({ userId, accountId: args.loanId });
      const limit = args.limit ?? DEFAULT_LIMIT;

      return jsonContent({ data: { points: series.slice(-limit), total: series.length } });
    },
  );
}
