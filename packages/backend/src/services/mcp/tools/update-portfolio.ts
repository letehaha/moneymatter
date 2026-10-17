import { PORTFOLIO_TYPE } from '@bt/shared/types/investments';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { updatePortfolio } from '@services/investments/portfolios/update.service';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  portfolioId: recordId().describe('Portfolio ID (from get_portfolios)'),
  name: z.string().optional().describe('New portfolio name (must be unique for this user)'),
  portfolioType: z
    .enum([PORTFOLIO_TYPE.investment, PORTFOLIO_TYPE.retirement, PORTFOLIO_TYPE.savings, PORTFOLIO_TYPE.other])
    .optional()
    .describe('New portfolio type: investment, retirement, savings, or other'),
  description: z.string().nullable().optional().describe('New description (pass null to clear)'),
  isEnabled: z.boolean().optional().describe('Enable or disable the portfolio'),
};

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

      const portfolio = await updatePortfolio({
        userId,
        portfolioId: args.portfolioId,
        name: args.name,
        portfolioType: args.portfolioType as PORTFOLIO_TYPE | undefined,
        description: args.description,
        isEnabled: args.isEnabled,
      });

      return jsonContent({ data: portfolio });
    },
  );
}
