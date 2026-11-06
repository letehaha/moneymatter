import { recordId } from '@common/lib/zod/custom-types';
import { linkTransactionToPortfolio } from '@services/investments/portfolios/transfers';
import { z } from 'zod';

import { defineTool } from '../define-tool';
import { slimPortfolioTransferForMcp } from '../serializers';

export const linkTransactionToPortfolioTool = defineTool({
  name: 'link_transaction_to_portfolio',
  toolset: 'investments',
  access: 'write',
  description:
    'Link an existing regular transaction to an investment portfolio as a cash transfer. An expense transaction moves cash from its account into the portfolio; an income transaction moves cash from the portfolio to its account. The transaction must not already be a transfer or linked to a portfolio. Returns the created portfolio transfer.',
  input: {
    transactionId: recordId().describe('ID of the existing transaction (from search_transactions)'),
    portfolioId: recordId().describe('Portfolio ID (from get_portfolios)'),
    affectsCash: z
      .boolean()
      .optional()
      .describe(
        'true (default): the transaction moves the portfolio cash balance; false: link it without changing cash',
      ),
  },
  run: async ({ userId, args }) => {
    const transfer = await linkTransactionToPortfolio({
      userId,
      transactionId: args.transactionId,
      portfolioId: args.portfolioId,
      affectsCash: args.affectsCash,
    });

    return slimPortfolioTransferForMcp(transfer);
  },
});
