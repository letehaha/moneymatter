import { recordId } from '@common/lib/zod/custom-types';
import { getPortfolio } from '@services/investments/portfolios/get.service';

import { defineTool } from '../define-tool';
import { presentPortfolio } from './portfolio-output';

export const getPortfolioTool = defineTool({
  name: 'get_portfolio',
  toolset: 'investments',
  access: 'read',
  description:
    'Read one portfolio by id: name, portfolio type (investment/retirement/savings/other), description, enabled state and creation date. Use get_portfolio_summary for its values and gains.',
  input: {
    portfolioId: recordId().describe('Portfolio ID (from get_portfolios)'),
  },
  run: async ({ userId, args }) => {
    const portfolio = await getPortfolio({ userId, portfolioId: args.portfolioId });

    return presentPortfolio({ portfolio });
  },
});
