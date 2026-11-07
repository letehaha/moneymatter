import { recordId } from '@common/lib/zod/custom-types';
import { exchangeCurrencyBodySchema } from '@controllers/investments/portfolios/schemas';
import { exchangeCurrency } from '@services/investments/portfolios/transfers';

import { defineTool } from '../define-tool';
import { slimPortfolioTransferForMcp } from '../serializers';

const shape = exchangeCurrencyBodySchema.shape;

export const exchangePortfolioCurrencyTool = defineTool({
  name: 'exchange_portfolio_currency',
  toolset: 'investments',
  access: 'write',
  description:
    'Record a currency exchange inside a portfolio: sells fromAmount of one cash currency and buys toAmount of another. The balance of the bought currency is created when the portfolio has none. A balance may go negative (margin). Returns the exchange as a transfer with toCurrencyCode and toAmount.',
  input: {
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
  },
  run: async ({ userId, args }) => {
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

    return slimPortfolioTransferForMcp(transfer);
  },
});
