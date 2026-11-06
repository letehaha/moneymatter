import { PORTFOLIO_TYPE } from '@bt/shared/types/investments';
import { listPortfolios } from '@services/investments/portfolios/list.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';
import { presentPortfolio } from './portfolio-output';

export const getPortfoliosTool = defineTool({
  name: 'get_portfolios',
  toolset: 'investments',
  access: 'read',
  description:
    "List the user's investment portfolios. Returns id, name, portfolio type (investment/retirement/savings/other), description, enabled state, and creation date. Use the returned id with get_portfolio_summary, get_portfolio_holdings, get_portfolio_balances, and get_investment_transactions.",
  input: {
    portfolioType: z
      .enum([PORTFOLIO_TYPE.investment, PORTFOLIO_TYPE.retirement, PORTFOLIO_TYPE.savings, PORTFOLIO_TYPE.other])
      .optional()
      .describe('Filter by portfolio type'),
    isEnabled: z.boolean().optional().describe('Filter by enabled state'),
    limit: z.number().optional().describe('Max results'),
    offset: z.number().optional().describe('Pagination offset (default: 0)'),
  },
  run: async ({ userId, args }) => {
    const portfolios = await listPortfolios({
      userId,
      portfolioType: args.portfolioType as PORTFOLIO_TYPE | undefined,
      isEnabled: args.isEnabled,
      limit: args.limit,
      offset: args.offset,
    });

    return portfolios.map((portfolio) => presentPortfolio({ portfolio }));
  },
});
