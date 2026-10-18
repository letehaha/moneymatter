import { recordId } from '@common/lib/zod/custom-types';
import { portfolioTransferBodySchema } from '@controllers/investments/portfolios/schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createPortfolioTransfer } from '@services/investments/portfolios/transfers';

import { slimPortfolioTransferForMcp } from '../serializers';
import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const shape = portfolioTransferBodySchema.shape;

const inputSchema = {
  fromPortfolioId: recordId().describe('Source portfolio ID (from get_portfolios)'),
  toPortfolioId: shape.toPortfolioId.describe(
    'Destination portfolio ID (from get_portfolios). Must differ from the source',
  ),
  currencyCode: shape.currencyCode.describe('ISO currency code of the cash that moves (e.g. "USD")'),
  amount: shape.amount.describe('Amount as a positive decimal string (e.g. "500.00")'),
  date: shape.date.describe('Transfer date in YYYY-MM-DD format'),
  description: shape.description.describe('Optional note for the transfer'),
};

export function registerTransferBetweenPortfolios(server: McpServer) {
  server.registerTool(
    'transfer_between_portfolios',
    {
      description:
        'Move cash from one portfolio to another, in one currency. Lowers the source portfolio cash balance and raises the destination one; no account transaction is created. Use transfer_account_to_portfolio or transfer_portfolio_to_account to move cash to or from a regular account. Returns the transfer. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'transfer_between_portfolios', clientId: extra.authInfo?.clientId });

      const transfer = await createPortfolioTransfer({
        userId,
        fromPortfolioId: args.fromPortfolioId,
        toPortfolioId: args.toPortfolioId,
        currencyCode: args.currencyCode,
        amount: args.amount,
        date: args.date,
        description: args.description || null,
      });

      return jsonContent({ data: slimPortfolioTransferForMcp(transfer) });
    },
  );
}
