import { deleteHoldingBodySchema } from '@controllers/investments/holdings/schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deleteHolding } from '@services/investments/holdings/delete-holding.service';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const shape = deleteHoldingBodySchema.shape;

const inputSchema = {
  portfolioId: shape.portfolioId.describe('Portfolio ID (from get_portfolios)'),
  securityId: shape.securityId.describe('ID of the security to remove (from get_portfolio_holdings)'),
  force: shape.force.describe(
    'Default false: only a holding with no quantity left is removed. true also deletes every investment transaction of the security in this portfolio and reverses their cash effect',
  ),
};

export function registerDeleteHolding(server: McpServer) {
  server.registerTool(
    'delete_holding',
    {
      description:
        'Remove a security from a portfolio. Without force, a holding that still has a quantity is refused. With force=true, every investment transaction of that security in the portfolio is deleted as well and the portfolio cash is restored to what it was before them. That is irreversible: confirm with the user before using force. Requires finance:delete scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_holding', clientId: extra.authInfo?.clientId });

      await deleteHolding({
        userId,
        portfolioId: args.portfolioId,
        securityId: args.securityId,
        force: args.force,
      });

      return jsonContent({ data: { deleted: true, portfolioId: args.portfolioId, securityId: args.securityId } });
    },
  );
}
