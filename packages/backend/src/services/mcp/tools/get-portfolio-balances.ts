import { recordId } from '@common/lib/zod/custom-types';
import { getPortfolioBalances } from '@services/investments/portfolios/balances';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const getPortfolioBalancesTool = defineTool({
  name: 'get_portfolio_balances',
  toolset: 'investments',
  access: 'read',
  description:
    "Cash balances held in a portfolio, broken down per currency. Each entry includes totalCash and availableCash in the original currency plus their ref* equivalents converted to the user's base currency. Useful for answering 'how much cash do I have to invest'.",
  input: {
    portfolioId: recordId().describe('Portfolio ID (from get_portfolios)'),
    currencyCode: z
      .string()
      .optional()
      .describe('ISO 4217 currency code (e.g., "USD"). Omit to return balances in all currencies.'),
  },
  run: async ({ userId, args }) => {
    const balances = await getPortfolioBalances({
      userId,
      portfolioId: args.portfolioId,
      currencyCode: args.currencyCode,
    });

    // Drop the embedded full Currencies model (redundant with currencyCode)
    // and audit timestamps. Money fields serialize to plain decimal numbers.
    return balances.map((b) => ({
      portfolioId: b.portfolioId,
      currencyCode: b.currencyCode,
      totalCash: b.totalCash,
      availableCash: b.availableCash,
      refTotalCash: b.refTotalCash,
      refAvailableCash: b.refAvailableCash,
    }));
  },
});
