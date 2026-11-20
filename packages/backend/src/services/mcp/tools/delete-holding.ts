import { deleteHoldingBodySchema } from '@controllers/investments/holdings/schemas';
import { deleteHolding } from '@services/investments/holdings/delete-holding.service';

import { defineTool } from '../define-tool';

const shape = deleteHoldingBodySchema.shape;

export const deleteHoldingTool = defineTool({
  name: 'delete_holding',
  toolset: 'investments',
  access: 'delete',
  description:
    'Remove a security from a portfolio. Without force, a holding that still has a quantity is refused. With force=true, every investment transaction of that security in the portfolio is deleted as well and the portfolio cash is restored to what it was before them. That is irreversible: confirm with the user before using force.',
  input: {
    portfolioId: shape.portfolioId.describe('Portfolio ID (from get_portfolios)'),
    securityId: shape.securityId.describe('ID of the security to remove (from get_portfolio_holdings)'),
    force: shape.force.describe(
      'Default false: only a holding with no quantity left is removed. true also deletes every investment transaction of the security in this portfolio and reverses their cash effect',
    ),
  },
  run: async ({ userId, args }) => {
    await deleteHolding({
      userId,
      portfolioId: args.portfolioId,
      securityId: args.securityId,
      force: args.force,
    });

    return { deleted: true, portfolioId: args.portfolioId, securityId: args.securityId };
  },
});
