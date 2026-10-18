import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getPortfolioSummaries } from '@services/investments/portfolios/get-portfolio-summaries.service';
import { getPortfoliosAnnualizedReturns } from '@services/investments/portfolios/get-portfolios-annualized-returns.service';

import { getUserId, jsonContent } from './helpers';

export function registerGetPortfoliosOverview(server: McpServer) {
  server.registerTool(
    'get_portfolios_overview',
    {
      description:
        'Overview of all portfolios in one call. Returns { summaries, annualizedReturns }: summaries holds one entry per portfolio (current value, cost basis, realized and unrealized gains, cash, total value, as decimal strings in the portfolio display currency or the base currency); annualizedReturns holds the annualized time-weighted return of each enabled portfolio with enough history. Use get_portfolio_summary for a single portfolio at a past date.',
    },
    async (extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_portfolios_overview', clientId: extra.authInfo?.clientId });

      const [summaries, annualizedReturns] = await Promise.all([
        getPortfolioSummaries({ userId }),
        getPortfoliosAnnualizedReturns({ userId }),
      ]);

      return jsonContent({ data: { summaries, annualizedReturns } });
    },
  );
}
