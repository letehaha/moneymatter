import { INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types/investments';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { updateInvestmentTransaction } from '@services/investments/transactions/update.service';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  transactionId: recordId().describe('Investment transaction ID (from get_investment_transactions)'),
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
    .optional()
    .describe('New transaction category'),
  date: z
    .union([z.string().date(), z.string().datetime({ offset: true })])
    .optional()
    .describe(
      'When the trade occurred. Accepts a date-only value (ISO 8601, e.g. "2024-03-15") or a full datetime (e.g. "2024-03-15T09:30:00.000Z"); date-only is stored at UTC midnight.',
    ),
  quantity: z.string().optional().describe('New share quantity as a decimal string'),
  price: z.string().optional().describe('New price per share as a decimal string'),
  fees: z.string().optional().describe('New fees/commissions as a decimal string'),
  name: z.string().optional().describe('New label or note'),
};

export function registerUpdateInvestmentTransaction(server: McpServer) {
  server.registerTool(
    'update_investment_transaction',
    {
      description:
        'Update an existing investment transaction — correct the date, quantity, price, fees, category, or label. Obtain the transactionId from get_investment_transactions. Only provided fields are changed; the holding recalculation runs automatically after every update.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'update_investment_transaction', clientId: extra.authInfo?.clientId });

      const transaction = await updateInvestmentTransaction({
        userId,
        transactionId: args.transactionId,
        category: args.category as INVESTMENT_TRANSACTION_CATEGORY | undefined,
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
