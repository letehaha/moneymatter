import { recordId } from '@common/lib/zod/custom-types';
import { createHoldingBodySchema, SecuritySearchResultSchema } from '@controllers/investments/holdings/schemas';
import { createHoldingFromInput } from '@services/investments/holdings/create-holding-from-input.service';

import { defineTool } from '../define-tool';
import { presentHolding } from './holding-output';

export const createHoldingTool = defineTool({
  name: 'create_holding',
  toolset: 'investments',
  access: 'write',
  description:
    'Add a security to a portfolio, so investment transactions can be recorded against it. Pass exactly one of securityId (a security the app already knows) and searchResult (one result of search_securities, unchanged: the security is created from it first). Returns the holding with its securityId: use that securityId in create_investment_transaction. A security already in the portfolio is refused. Historical prices load in the background.',
  input: {
    portfolioId: recordId().describe('Portfolio ID (from get_portfolios)'),
    securityId: recordId()
      .optional()
      .describe('ID of a security the app already knows (from get_portfolio_holdings). Set this or searchResult'),
    searchResult: SecuritySearchResultSchema.optional().describe(
      'One result of search_securities, passed as it came back. Set this or securityId',
    ),
  },
  // The REST body rule: a portfolio plus exactly one of a security id and a search result.
  validate: ({ args }) => createHoldingBodySchema.parse(args),
  run: async ({ userId, args: { portfolioId, securityId, searchResult } }) => {
    const holding = await createHoldingFromInput({ userId, portfolioId, securityId, searchResult });

    return presentHolding({ holding });
  },
});
