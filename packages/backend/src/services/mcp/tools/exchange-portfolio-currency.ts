import { recordId } from '@common/lib/zod/custom-types';
import { exchangeCurrencyBodySchema } from '@controllers/investments/portfolios/schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { exchangeCurrency } from '@services/investments/portfolios/transfers';

import { slimPortfolioTransferForMcp } from '../serializers';
import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const shape = exchangeCurrencyBodySchema.shape;

const inputSchema = {
  portfolioId: recordId().describe('Portfolio ID (from get_portfolios)'),
  fromCurrencyCode: shape.fromCurrencyCode.describe('ISO currency code of the cash that is sold (e.g. "USD")'),
  toCurrencyCode: shape.toCurrencyCode.describe(
    'ISO currency code of the cash that is bought. Must differ from fromCurrencyCode',
  ),
  fromAmount: shape.fromAmount.describe('Amount sold, as a positive decimal string'),
  toAmount: shape.toAmount.describe(
    'Amount received, as a positive decimal string. It sets the rate, so enter what the broker credited',
  ),
  date: shape.date.describe('Exchange date in YYYY-MM-DD format'),
  description: shape.description.describe('Optional note for the exchange'),
};

export function registerExchangePortfolioCurrency(server: McpServer) {
  server.registerTool(
    'exchange_portfolio_currency',
    {
      description:
        'Record a currency exchange inside a portfolio: sells fromAmount of one cash currency and buys toAmount of another. The balance of the bought currency is created when the portfolio has none. A balance may go negative (margin). Returns the exchange as a transfer with toCurrencyCode and toAmount. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'exchange_portfolio_currency', clientId: extra.authInfo?.clientId });

      const transfer = await exchangeCurrency({
        userId,
        portfolioId: args.portfolioId,
        fromCurrencyCode: args.fromCurrencyCode,
        toCurrencyCode: args.toCurrencyCode,
        fromAmount: args.fromAmount,
        toAmount: args.toAmount,
        date: args.date,
        description: args.description || null,
      });

      return jsonContent({ data: slimPortfolioTransferForMcp(transfer) });
    },
  );
}
