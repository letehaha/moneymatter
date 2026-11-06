import { recordId } from '@common/lib/zod/custom-types';
import { getHoldings } from '@services/investments/holdings/get-holdings.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const getPortfolioHoldingsTool = defineTool({
  name: 'get_portfolio_holdings',
  toolset: 'investments',
  access: 'read',
  description:
    'Positions held in a portfolio with dynamically calculated market value, cost basis, and realized/unrealized gain (value and percent). Each holding includes the embedded security (symbol, name, asset class, currency). Filter by securityId to look at a single position.',
  input: {
    portfolioId: recordId().describe('Portfolio ID (from get_portfolios)'),
    securityId: recordId().optional().describe('Filter to a specific security'),
    date: z.string().optional().describe('Date for historical valuation (ISO 8601). Default: latest available prices'),
  },
  run: async ({ userId, args }) => {
    const holdings = await getHoldings({
      userId,
      portfolioId: args.portfolioId,
      securityId: args.securityId,
      date: args.date ? new Date(args.date) : undefined,
    });

    // The shared service embeds the full Securities model (~20 fields, mostly
    // provider/exchange metadata and nulls) which is wasted context for AI
    // clients. Keep only what an assistant reasons about. The holding's own
    // securityId/currencyCode already cover identity and currency.
    return holdings.map(({ security, ...holding }) => ({
      ...holding,
      security: security
        ? { symbol: security.symbol, name: security.name, assetClass: security.assetClass }
        : undefined,
    }));
  },
});
