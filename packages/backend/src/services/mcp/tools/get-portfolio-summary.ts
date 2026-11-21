import { recordId } from '@common/lib/zod/custom-types';
import { getPortfolioSummary } from '@services/investments/portfolios/get-portfolio-summary.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const getPortfolioSummaryTool = defineTool({
  name: 'get_portfolio_summary',
  toolset: 'investments',
  access: 'read',
  description:
    "Portfolio-level aggregates for a single portfolio: total current market value, total cost basis, realized and unrealized gains (value and percent), cash balances, and total portfolio value (holdings + cash). All monetary values are decimals in the user's base currency.",
  input: {
    portfolioId: recordId().describe('Portfolio ID (from get_portfolios)'),
    date: z.string().optional().describe('Date for historical snapshot (ISO 8601). Default: latest available prices'),
  },
  run: ({ userId, args }) =>
    getPortfolioSummary({
      userId,
      portfolioId: args.portfolioId,
      date: args.date ? new Date(args.date) : undefined,
    }),
});
