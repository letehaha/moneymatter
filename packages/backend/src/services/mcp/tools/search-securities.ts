import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { findStoredSecurityIds } from '@services/investments/securities/find-stored.service';
import { searchSecurities } from '@services/investments/securities/search.service';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';
import { presentSecuritySearchResult } from './holding-output';

const inputSchema = {
  query: z.string().describe('Ticker symbol or company name to search for (e.g. "AAPL", "Apple")'),
  portfolioId: z
    .string()
    .uuid()
    .optional()
    .describe('Portfolio ID to annotate results with isInPortfolio flag (from get_portfolios)'),
  limit: z.number().optional().describe('Maximum number of results to return (default: 20)'),
};

export function registerSearchSecurities(server: McpServer) {
  server.registerTool(
    'search_securities',
    {
      description:
        "Search for securities (stocks, ETFs, crypto, etc.) by ticker symbol or company name. Each result carries everything create_holding needs: pass a result unchanged as create_holding's searchResult to add the security to a portfolio, then read the securityId from the create_holding result (or from get_portfolio_holdings) before create_investment_transaction. A result whose security is already stored carries its securityId, which get_security_prices takes to read the stored prices. If portfolioId is provided, each result includes isInPortfolio to indicate whether the security is already tracked in that portfolio.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'search_securities', clientId: extra.authInfo?.clientId });

      const results = await searchSecurities({
        query: args.query,
        limit: args.limit,
        portfolioId: args.portfolioId,
        user: { id: userId } as any,
      });

      const storedIds = await findStoredSecurityIds({ results });

      return jsonContent({
        data: results.map((result, index) => presentSecuritySearchResult({ result, securityId: storedIds[index] })),
      });
    },
  );
}
