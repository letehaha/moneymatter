import { dateString, isoCurrencyCode, positiveAmountString, recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { directCashTransaction } from '@services/investments/portfolios/transfers';
import { z } from 'zod';

import { slimPortfolioTransferForMcp } from '../serializers';
import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  portfolioId: recordId().describe('Portfolio ID (from get_portfolios)'),
  type: z.enum(['deposit', 'withdrawal']).describe('deposit adds cash to the portfolio, withdrawal removes it'),
  amount: positiveAmountString().describe('Amount as a positive decimal string (e.g. "500.00")'),
  currencyCode: isoCurrencyCode().describe('Currency of the cash (ISO 4217, e.g. "USD")'),
  date: dateString().describe('Date in YYYY-MM-DD format'),
  description: z.string().optional().describe('Optional note'),
  isAdjustment: z
    .boolean()
    .optional()
    .describe(
      'Set true when the entry only reconciles recorded cash to reality (excluded from contribution reporting). Default: false',
    ),
};

export function registerCreatePortfolioCashTransaction(server: McpServer) {
  server.registerTool(
    'create_portfolio_cash_transaction',
    {
      description:
        'Record a direct cash deposit into or withdrawal from an investment portfolio without touching any regular account — no bank transaction is created. Use transfer_account_to_portfolio / transfer_portfolio_to_account when the money moves to or from a tracked account.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_portfolio_cash_transaction', clientId: extra.authInfo?.clientId });

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

      return jsonContent({ data: slimPortfolioTransferForMcp(transfer) });
    },
  );
}
