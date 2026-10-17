import { INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types/investments';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createInvestmentTransaction } from '@services/investments/transactions/create.service';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  portfolioId: recordId().describe('Portfolio ID (from get_portfolios)'),
  securityId: recordId().describe('Security ID — resolve via search_securities first'),
  category: z
    .enum([
      INVESTMENT_TRANSACTION_CATEGORY.buy,
      INVESTMENT_TRANSACTION_CATEGORY.sell,
      INVESTMENT_TRANSACTION_CATEGORY.dividend,
      INVESTMENT_TRANSACTION_CATEGORY.transfer,
      INVESTMENT_TRANSACTION_CATEGORY.tax,
      INVESTMENT_TRANSACTION_CATEGORY.fee,
      INVESTMENT_TRANSACTION_CATEGORY.cancel,
      INVESTMENT_TRANSACTION_CATEGORY.other,
    ])
    .describe('Transaction type: buy, sell, dividend, transfer, tax, fee, cancel, or other'),
  date: z
    .union([z.string().date(), z.string().datetime({ offset: true })])
    .describe(
      'When the trade occurred. Accepts a date-only value (ISO 8601, e.g. "2024-03-15") or a full datetime (e.g. "2024-03-15T09:30:00.000Z"); date-only is stored at UTC midnight.',
    ),
  quantity: z.string().describe('Number of shares/units as a decimal string (e.g. "10.5")'),
  price: z.string().describe('Price per share/unit as a decimal string (e.g. "150.00")'),
  fees: z.string().describe('Transaction fees/commissions as a decimal string (e.g. "0.00")'),
  name: z.string().optional().describe('Optional label or note for this transaction'),
};

export function registerCreateInvestmentTransaction(server: McpServer) {
  server.registerTool(
    'create_investment_transaction',
    {
      description:
        'Record a new investment transaction (buy, sell, dividend, fee, etc.) in a portfolio. The security must already exist in the portfolio as a holding — call search_securities to resolve a ticker to a securityId, then ensure a holding exists. quantity, price, and fees are decimal strings (e.g. "10.5", "150.00", "0.00").',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_investment_transaction', clientId: extra.authInfo?.clientId });

      const transaction = await createInvestmentTransaction({
        userId,
        portfolioId: args.portfolioId,
        securityId: args.securityId,
        category: args.category as INVESTMENT_TRANSACTION_CATEGORY,
        date: args.date,
        quantity: args.quantity,
        price: args.price,
        fees: args.fees,
        name: args.name,
      });

      return jsonContent({ data: transaction });
    },
  );
}
