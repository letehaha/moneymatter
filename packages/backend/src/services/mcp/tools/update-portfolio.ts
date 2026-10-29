import { recordId } from '@common/lib/zod/custom-types';
import { updatePortfolioBodySchema, updatePortfolioBodyShape } from '@controllers/investments/portfolios/schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { updatePortfolio } from '@services/investments/portfolios/update.service';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope, type ToolArgs } from './helpers';

const inputSchema = {
  portfolioId: recordId().describe('Portfolio ID (from get_portfolios)'),
  name: updatePortfolioBodyShape.name.describe('New portfolio name (must be unique for this user), 1-255 characters'),
  portfolioType: updatePortfolioBodyShape.portfolioType.describe(
    'New portfolio type: investment, retirement, savings, or other',
  ),
  description: updatePortfolioBodyShape.description.describe('New description (pass null to clear)'),
  isEnabled: updatePortfolioBodyShape.isEnabled.describe('Enable or disable the portfolio'),
  displayCurrencyCode: updatePortfolioBodyShape.displayCurrencyCode.describe(
    'New display currency (ISO code, must be one of the user currencies); null = use base currency, omit = keep',
  ),
};

/** The at-least-one-field rule spans fields, so it runs on the REST body schema. */
export function validateUpdatePortfolioArgs({ args }: { args: ToolArgs<typeof inputSchema> }) {
  const { portfolioId, ...fields } = args;
  return { portfolioId, ...updatePortfolioBodySchema.parse(fields) };
}

export function registerUpdatePortfolio(server: McpServer) {
  server.registerTool(
    'update_portfolio',
    {
      description:
        "Update an existing portfolio's name, type, description, or enabled state. Use when the user wants to rename, recategorize, or disable one of their portfolios. Obtain the portfolioId from get_portfolios first. Only the fields provided are changed.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'update_portfolio', clientId: extra.authInfo?.clientId });

      const { portfolioId, ...body } = validateUpdatePortfolioArgs({ args });

      const portfolio = await updatePortfolio({ userId, portfolioId, ...body });

      return jsonContent({ data: portfolio });
    },
  );
}
