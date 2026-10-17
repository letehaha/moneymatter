import { currencyCode, dateString, positiveAmountString, recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { portfolioToAccountTransfer } from '@services/investments/portfolios/transfers';
import { z } from 'zod';

import { slimPortfolioTransferForMcp } from '../serializers';
import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  portfolioId: recordId().describe('Source portfolio ID (from get_portfolios)'),
  accountId: recordId().describe('Destination account ID (from get_accounts)'),
  amount: positiveAmountString().describe('Amount as a positive decimal string (e.g. "500.00")'),
  currencyCode: currencyCode().describe('Currency of the cash withdrawn from the portfolio (ISO 4217, e.g. "USD")'),
  date: dateString().describe('Transfer date in YYYY-MM-DD format'),
  description: z.string().optional().describe('Optional note for the transfer'),
};

export function registerTransferPortfolioToAccount(server: McpServer) {
  server.registerTool(
    'transfer_portfolio_to_account',
    {
      description:
        'Withdraw cash from an investment portfolio into a regular account. Creates an income transaction on the account and decreases the portfolio cash balance. Use link_transaction_to_portfolio instead when the bank transaction already exists.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'transfer_portfolio_to_account', clientId: extra.authInfo?.clientId });

      const transfer = await portfolioToAccountTransfer({
        userId,
        portfolioId: args.portfolioId,
        accountId: args.accountId,
        amount: args.amount,
        currencyCode: args.currencyCode,
        date: args.date,
        description: args.description ?? null,
      });

      return jsonContent({ data: slimPortfolioTransferForMcp(transfer) });
    },
  );
}
