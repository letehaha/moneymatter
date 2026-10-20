import {
  createInvestmentTransactionBodySchema,
  createInvestmentTransactionBodyShape,
} from '@controllers/investments/transactions/schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createInvestmentTransaction } from '@services/investments/transactions/create.service';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const shape = createInvestmentTransactionBodyShape;

const inputSchema = {
  portfolioId: shape.portfolioId.describe('Portfolio ID (from get_portfolios)'),
  securityId: shape.securityId.describe('Security ID — resolve via search_securities first'),
  category: shape.category.describe('Transaction type: buy, sell, dividend, transfer, tax, fee, cancel, or other'),
  date: shape.date.describe(
    'When the trade occurred. Accepts a date-only value (ISO 8601, e.g. "2024-03-15") or a full datetime (e.g. "2024-03-15T09:30:00.000Z"); date-only is stored at UTC midnight.',
  ),
  quantity: shape.quantity.describe('Number of shares/units as a decimal string (e.g. "10.5")'),
  price: shape.price.describe(
    'Price per share/unit as a decimal string (e.g. "150.00"). 0 is allowed for a position change with no cash (staking, airdrop)',
  ),
  fees: shape.fees.describe('Transaction fees/commissions as a decimal string (default "0")'),
  name: shape.name.describe('Optional label or note for this transaction'),
  settlementCurrencyCode: shape.settlementCurrencyCode.describe(
    'Currency of the cash that actually moved, when it differs from the security currency. Requires settlementAmount',
  ),
  settlementAmount: shape.settlementAmount.describe(
    'Cash that moved in the settlement currency (decimal string). Requires settlementCurrencyCode',
  ),
  settlementFees: shape.settlementFees.describe('Fees in the settlement currency. Not together with settlementRate'),
  settlementRate: shape.settlementRate.describe(
    'Known security-to-settlement rate; the fee is derived as the residual. Requires settlementCurrencyCode, not together with settlementFees. With neither, the market rate of the trade date is used',
  ),
};

export function registerCreateInvestmentTransaction(server: McpServer) {
  server.registerTool(
    'create_investment_transaction',
    {
      description:
        'Record a new investment transaction (buy, sell, dividend, fee, etc.) in a portfolio. The security must already exist in the portfolio as a holding — call search_securities to resolve a ticker to a securityId, then ensure a holding exists. quantity, price, and fees are decimal strings (e.g. "10.5", "150.00", "0.00"). For a trade settled in another currency add the settlement* fields.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_investment_transaction', clientId: extra.authInfo?.clientId });

      // The settlement either-or rules span fields, so they run on the REST body schema.
      const body = createInvestmentTransactionBodySchema.parse(args);
      const transaction = await createInvestmentTransaction({ userId, ...body });

      return jsonContent({ data: transaction });
    },
  );
}
