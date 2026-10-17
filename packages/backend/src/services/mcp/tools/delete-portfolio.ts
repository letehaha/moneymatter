import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deletePortfolio } from '@services/investments/portfolios/delete.service';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  portfolioId: recordId().describe('Portfolio ID to delete (from get_portfolios)'),
  force: z
    .boolean()
    .optional()
    .describe(
      'If true, also deletes all holdings, transactions, and balances associated with this portfolio. Default: false.',
    ),
};

export function registerDeletePortfolio(server: McpServer) {
  server.registerTool(
    'delete_portfolio',
    {
      description:
        'Permanently delete a portfolio and, if force is true, all its holdings, transactions, and cash balances. Without force, deletion is blocked when the portfolio has any data. This action is irreversible — confirm with the user before calling. Obtain portfolioId from get_portfolios.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_portfolio', clientId: extra.authInfo?.clientId });

      const result = await deletePortfolio({
        userId,
        portfolioId: args.portfolioId,
        force: args.force,
      });

      return jsonContent({ data: result });
    },
  );
}
