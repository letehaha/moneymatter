import { recordId } from '@common/lib/zod/custom-types';
import { portfolioTransferBodySchema } from '@controllers/investments/portfolios/schemas';
import { createPortfolioTransfer } from '@services/investments/portfolios/transfers';

import { defineTool } from '../define-tool';
import { slimPortfolioTransferForMcp } from '../serializers';

const shape = portfolioTransferBodySchema.shape;

export const transferBetweenPortfoliosTool = defineTool({
  name: 'transfer_between_portfolios',
  toolset: 'investments',
  access: 'write',
  description:
    'Move cash from one portfolio to another, in one currency. Lowers the source portfolio cash balance and raises the destination one; no account transaction is created. Use transfer_account_to_portfolio or transfer_portfolio_to_account to move cash to or from a regular account. Returns the transfer.',
  input: {
    fromPortfolioId: recordId().describe('Source portfolio ID (from get_portfolios)'),
    toPortfolioId: shape.toPortfolioId.describe(
      'Destination portfolio ID (from get_portfolios). Must differ from the source',
    ),
    currencyCode: shape.currencyCode.describe('ISO currency code of the cash that moves (e.g. "USD")'),
    amount: shape.amount.describe('Amount as a positive decimal string (e.g. "500.00")'),
    date: shape.date.describe('Transfer date in YYYY-MM-DD format'),
    description: shape.description.describe('Optional note for the transfer'),
  },
  run: async ({ userId, args }) => {
    const transfer = await createPortfolioTransfer({
      userId,
      fromPortfolioId: args.fromPortfolioId,
      toPortfolioId: args.toPortfolioId,
      currencyCode: args.currencyCode,
      amount: args.amount,
      date: args.date,
      description: args.description || null,
    });

    return slimPortfolioTransferForMcp(transfer);
  },
});
