import { PORTFOLIO_TYPE } from '@bt/shared/types/investments';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listPortfolios } from '@services/investments/portfolios/list.service';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';
import { presentPortfolio } from './portfolio-output';

const inputSchema = {
  portfolioType: z
    .enum([PORTFOLIO_TYPE.investment, PORTFOLIO_TYPE.retirement, PORTFOLIO_TYPE.savings, PORTFOLIO_TYPE.other])
    .optional()
    .describe('Filter by portfolio type'),
  isEnabled: z.boolean().optional().describe('Filter by enabled state'),
  limit: z.number().optional().describe('Max results'),
  offset: z.number().optional().describe('Pagination offset (default: 0)'),
};

export function registerGetPortfolios(server: McpServer) {
  server.registerTool(
    'get_portfolios',
    {
      description:
        "List the user's investment portfolios. Returns id, name, portfolio type (investment/retirement/savings/other), description, enabled state, and creation date. Use the returned id with get_portfolio_summary, get_portfolio_holdings, get_portfolio_balances, and get_investment_transactions.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_portfolios', clientId: extra.authInfo?.clientId });

      const portfolios = await listPortfolios({
        userId,
        portfolioType: args.portfolioType as PORTFOLIO_TYPE | undefined,
        isEnabled: args.isEnabled,
        limit: args.limit,
        offset: args.offset,
      });

      return jsonContent({ data: portfolios.map((portfolio) => presentPortfolio({ portfolio })) });
    },
  );
}
