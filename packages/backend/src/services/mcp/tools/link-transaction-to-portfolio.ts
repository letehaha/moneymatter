import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { linkTransactionToPortfolio } from '@services/investments/portfolios/transfers';

import { slimPortfolioTransferForMcp } from '../serializers';
import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  transactionId: recordId().describe('ID of the existing transaction (from search_transactions)'),
  portfolioId: recordId().describe('Portfolio ID (from get_portfolios)'),
};

export function registerLinkTransactionToPortfolio(server: McpServer) {
  server.registerTool(
    'link_transaction_to_portfolio',
    {
      description:
        'Link an existing regular transaction to an investment portfolio as a cash transfer. An expense transaction moves cash from its account into the portfolio; an income transaction moves cash from the portfolio to its account. The transaction must not already be a transfer or linked to a portfolio. Returns the created portfolio transfer.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'link_transaction_to_portfolio', clientId: extra.authInfo?.clientId });

      const transfer = await linkTransactionToPortfolio({
        userId,
        transactionId: args.transactionId,
        portfolioId: args.portfolioId,
      });

      return jsonContent({ data: slimPortfolioTransferForMcp(transfer) });
    },
  );
}
