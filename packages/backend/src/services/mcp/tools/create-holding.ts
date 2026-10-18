import { recordId } from '@common/lib/zod/custom-types';
import { createHoldingBodySchema, SecuritySearchResultSchema } from '@controllers/investments/holdings/schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createHoldingFromInput } from '@services/investments/holdings/create-holding-from-input.service';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';
import { presentHolding } from './holding-output';

const inputSchema = {
  portfolioId: recordId().describe('Portfolio ID (from get_portfolios)'),
  securityId: recordId()
    .optional()
    .describe('ID of a security the app already knows (from get_portfolio_holdings). Set this or searchResult'),
  searchResult: SecuritySearchResultSchema.optional().describe(
    'One result of search_securities, passed as it came back. Set this or securityId',
  ),
};

export function registerCreateHolding(server: McpServer) {
  server.registerTool(
    'create_holding',
    {
      description:
        'Add a security to a portfolio, so investment transactions can be recorded against it. Pass exactly one of securityId (a security the app already knows) and searchResult (one result of search_securities, unchanged: the security is created from it first). Returns the holding with its securityId: use that securityId in create_investment_transaction. A security already in the portfolio is refused. Historical prices load in the background. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_holding', clientId: extra.authInfo?.clientId });

      // The REST body rule: a portfolio plus exactly one of a security id and a search result.
      const { portfolioId, securityId, searchResult } = createHoldingBodySchema.parse(args);

      const holding = await createHoldingFromInput({ userId, portfolioId, securityId, searchResult });

      return jsonContent({ data: presentHolding({ holding }) });
    },
  );
}
