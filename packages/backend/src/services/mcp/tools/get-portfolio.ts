import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getPortfolio } from '@services/investments/portfolios/get.service';

import { getUserId, jsonContent } from './helpers';
import { presentPortfolio } from './portfolio-output';

const inputSchema = {
  portfolioId: recordId().describe('Portfolio ID (from get_portfolios)'),
};

export function registerGetPortfolio(server: McpServer) {
  server.registerTool(
    'get_portfolio',
    {
      description:
        'Read one portfolio by id: name, portfolio type (investment/retirement/savings/other), description, enabled state and creation date. Use get_portfolio_summary for its values and gains.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_portfolio', clientId: extra.authInfo?.clientId });

      const portfolio = await getPortfolio({ userId, portfolioId: args.portfolioId });

      return jsonContent({ data: presentPortfolio({ portfolio }) });
    },
  );
}
