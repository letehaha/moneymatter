import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { restorePortfolio } from '@services/investments/portfolios/restore.service';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';
import { presentPortfolio } from './portfolio-output';

const inputSchema = {
  portfolioId: recordId().describe('ID of a deleted portfolio'),
};

export function registerRestorePortfolio(server: McpServer) {
  server.registerTool(
    'restore_portfolio',
    {
      description:
        'Restore a portfolio that was deleted without force, with its holdings, transactions and cash balances. Fails when the portfolio does not exist or is not deleted. Returns the restored portfolio. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'restore_portfolio', clientId: extra.authInfo?.clientId });

      const portfolio = await restorePortfolio({ userId, portfolioId: args.portfolioId });

      return jsonContent({ data: presentPortfolio({ portfolio }) });
    },
  );
}
