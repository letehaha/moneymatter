import { dateString, positiveAmountString, recordId } from '@common/lib/zod/custom-types';
import { accountToPortfolioTransfer } from '@services/investments/portfolios/transfers';
import { z } from 'zod';

import { defineTool } from '../define-tool';
import { slimPortfolioTransferForMcp } from '../serializers';

export const transferAccountToPortfolioTool = defineTool({
  name: 'transfer_account_to_portfolio',
  toolset: 'investments',
  access: 'write',
  description:
    'Move cash from a regular account into an investment portfolio. Creates an expense transaction on the account and increases the portfolio cash balance. Use link_transaction_to_portfolio instead when the bank transaction already exists.',
  input: {
    accountId: recordId().describe('Source account ID (from get_accounts). The transfer uses the account currency'),
    portfolioId: recordId().describe('Destination portfolio ID (from get_portfolios)'),
    amount: positiveAmountString().describe('Amount as a positive decimal string (e.g. "500.00")'),
    date: dateString().describe('Transfer date in YYYY-MM-DD format'),
    description: z.string().optional().describe('Optional note for the transfer'),
  },
  run: async ({ userId, args }) => {
    const transfer = await accountToPortfolioTransfer({
      userId,
      accountId: args.accountId,
      portfolioId: args.portfolioId,
      amount: args.amount,
      date: args.date,
      description: args.description ?? null,
    });

    return slimPortfolioTransferForMcp(transfer);
  },
});
