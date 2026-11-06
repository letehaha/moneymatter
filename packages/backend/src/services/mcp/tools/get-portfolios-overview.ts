import { dateBound } from '@common/lib/zod/custom-types';
import { getPortfolioSummaries } from '@services/investments/portfolios/get-portfolio-summaries.service';
import { getPortfoliosAnnualizedReturns } from '@services/investments/portfolios/get-portfolios-annualized-returns.service';

import { defineTool } from '../define-tool';

export const getPortfoliosOverviewTool = defineTool({
  name: 'get_portfolios_overview',
  toolset: 'investments',
  access: 'read',
  description:
    'Overview of all portfolios in one call. Returns { summaries, annualizedReturns }: summaries holds one entry per portfolio (current value, cost basis, realized and unrealized gains, cash, total value, as decimal strings in the portfolio display currency or the base currency); annualizedReturns holds the annualized time-weighted return of each enabled portfolio with enough history. Use get_portfolio_summary for a single portfolio at a past date.',
  input: {
    asOf: dateBound()
      .optional()
      .describe(
        'Past day (YYYY-MM-DD) to measure the annualized returns at. Default: today. The summaries are always current',
      ),
  },
  run: async ({ userId, args }) => {
    const [summaries, annualizedReturns] = await Promise.all([
      getPortfolioSummaries({ userId }),
      getPortfoliosAnnualizedReturns({ userId, asOf: args.asOf }),
    ]);

    return { summaries, annualizedReturns };
  },
});
