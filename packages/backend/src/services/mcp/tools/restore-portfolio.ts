import { recordId } from '@common/lib/zod/custom-types';
import { restorePortfolio } from '@services/investments/portfolios/restore.service';

import { defineTool } from '../define-tool';
import { presentPortfolio } from './portfolio-output';

export const restorePortfolioTool = defineTool({
  name: 'restore_portfolio',
  toolset: 'investments',
  access: 'write',
  description:
    'Restore a portfolio that was deleted without force, with its holdings, transactions and cash balances. Fails when the portfolio does not exist or is not deleted. Returns the restored portfolio.',
  input: {
    portfolioId: recordId().describe('ID of a deleted portfolio'),
  },
  run: async ({ userId, args }) => {
    const portfolio = await restorePortfolio({ userId, portfolioId: args.portfolioId });

    return presentPortfolio({ portfolio });
  },
});
