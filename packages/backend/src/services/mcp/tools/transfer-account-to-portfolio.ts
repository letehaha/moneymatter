import { dateString, positiveAmountString, recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { accountToPortfolioTransfer } from '@services/investments/portfolios/transfers';
import { z } from 'zod';

import { slimPortfolioTransferForMcp } from '../serializers';
import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  accountId: recordId().describe('Source account ID (from get_accounts). The transfer uses the account currency'),
  portfolioId: recordId().describe('Destination portfolio ID (from get_portfolios)'),
  amount: positiveAmountString().describe('Amount as a positive decimal string (e.g. "500.00")'),
  date: dateString().describe('Transfer date in YYYY-MM-DD format'),
  description: z.string().optional().describe('Optional note for the transfer'),
};

export function registerTransferAccountToPortfolio(server: McpServer) {
  server.registerTool(
    'transfer_account_to_portfolio',
    {
      description:
        'Move cash from a regular account into an investment portfolio. Creates an expense transaction on the account and increases the portfolio cash balance. Use link_transaction_to_portfolio instead when the bank transaction already exists.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'transfer_account_to_portfolio', clientId: extra.authInfo?.clientId });

      const transfer = await accountToPortfolioTransfer({
        userId,
        accountId: args.accountId,
        portfolioId: args.portfolioId,
        amount: args.amount,
        date: args.date,
        description: args.description ?? null,
      });

      return jsonContent({ data: slimPortfolioTransferForMcp(transfer) });
    },
  );
}
