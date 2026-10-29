import { createPortfolioBodyShape } from '@controllers/investments/portfolios/schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createPortfolio } from '@services/investments/portfolios/create.service';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  name: createPortfolioBodyShape.name.describe('Portfolio name (must be unique for this user), max 100 characters'),
  portfolioType: createPortfolioBodyShape.portfolioType.describe(
    'Type of portfolio: investment (default), retirement, savings, or other',
  ),
  description: createPortfolioBodyShape.description.describe('Optional description, max 500 characters'),
  isEnabled: createPortfolioBodyShape.isEnabled.describe('Whether the portfolio is active (default: true)'),
  displayCurrencyCode: createPortfolioBodyShape.displayCurrencyCode.describe(
    'Display currency (ISO code) for summary/holdings; must be one of the user currencies. Omit/null = base currency',
  ),
};

export function registerCreatePortfolio(server: McpServer) {
  server.registerTool(
    'create_portfolio',
    {
      description:
        'Create a new investment portfolio for the user. Use when the user wants to track a new brokerage account, retirement fund, or savings vehicle. Returns the created portfolio with its id, which can then be used with create_investment_transaction and get_portfolio_holdings.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_portfolio', clientId: extra.authInfo?.clientId });

      const portfolio = await createPortfolio({
        userId,
        name: args.name,
        portfolioType: args.portfolioType,
        description: args.description ?? null,
        displayCurrencyCode: args.displayCurrencyCode,
        isEnabled: args.isEnabled,
      });

      return jsonContent({ data: portfolio });
    },
  );
}
