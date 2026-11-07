import { currencyCode, dateString, positiveAmountString, recordId } from '@common/lib/zod/custom-types';
import { directCashTransaction } from '@services/investments/portfolios/transfers';
import { z } from 'zod';

import { defineTool } from '../define-tool';
import { slimPortfolioTransferForMcp } from '../serializers';

export const createPortfolioCashTransactionTool = defineTool({
  name: 'create_portfolio_cash_transaction',
  toolset: 'investments',
  access: 'write',
  description:
    'Record a direct cash deposit into or withdrawal from an investment portfolio without touching any regular account — no bank transaction is created. Use transfer_account_to_portfolio / transfer_portfolio_to_account when the money moves to or from a tracked account.',
  input: {
    portfolioId: recordId().describe('Portfolio ID (from get_portfolios)'),
    type: z.enum(['deposit', 'withdrawal']).describe('deposit adds cash to the portfolio, withdrawal removes it'),
    amount: positiveAmountString().describe('Amount as a positive decimal string (e.g. "500.00")'),
    currencyCode: currencyCode().describe('Currency of the cash (ISO 4217, e.g. "USD")'),
    date: dateString().describe('Date in YYYY-MM-DD format'),
    description: z.string().optional().describe('Optional note'),
    isAdjustment: z
      .boolean()
      .optional()
      .describe(
        'Set true when the entry only reconciles recorded cash to reality (excluded from contribution reporting). Default: false',
      ),
  },
  run: async ({ userId, args }) => {
    const transfer = await directCashTransaction({
      userId,
      portfolioId: args.portfolioId,
      type: args.type,
      amount: args.amount,
      currencyCode: args.currencyCode,
      date: args.date,
      description: args.description ?? null,
      isAdjustment: args.isAdjustment,
    });

    return slimPortfolioTransferForMcp(transfer);
  },
});
