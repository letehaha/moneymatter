import { recordId } from '@common/lib/zod/custom-types';
import { deletePortfolio } from '@services/investments/portfolios/delete.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const deletePortfolioTool = defineTool({
  name: 'delete_portfolio',
  toolset: 'investments',
  access: 'delete',
  description:
    'Permanently delete a portfolio and, if force is true, all its holdings, transactions, and cash balances. Without force, deletion is blocked when the portfolio has any data. This action is irreversible — confirm with the user before calling. Obtain portfolioId from get_portfolios.',
  input: {
    portfolioId: recordId().describe('Portfolio ID to delete (from get_portfolios)'),
    force: z
      .boolean()
      .optional()
      .describe(
        'If true, also deletes all holdings, transactions, and balances associated with this portfolio. Default: false.',
      ),
  },
  run: ({ userId, args }) =>
    deletePortfolio({
      userId,
      portfolioId: args.portfolioId,
      force: args.force,
    }),
});
