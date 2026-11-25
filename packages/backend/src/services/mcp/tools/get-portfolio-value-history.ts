import { dateRange, recordId, withDateOrder } from '@common/lib/zod/custom-types';
import { getPortfolioValueHistory } from '@services/investments/portfolios/get-portfolio-value-history.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const getPortfolioValueHistoryTool = defineTool({
  name: 'get_portfolio_value_history',
  toolset: 'investments',
  access: 'read',
  description:
    "Daily value history of one portfolio: total value, holdings value, cash, cost basis of open positions, cumulative realized gain, cumulative net deposits and cumulative time-weighted return per day. Money values are decimals in the portfolio's display currency (else the user's base currency); timeWeightedReturn is a fraction (0.05 = 5%) that starts at 0 on the first returned day; net deposits exclude adjustments and transfers within the portfolio; a holding with no price for a day is carried at cost basis. Returns { currencyCode, points }.",
  input: {
    portfolioId: recordId().describe('Portfolio ID (from get_portfolios)'),
    from: dateRange().from.describe("First day (YYYY-MM-DD). Default: the portfolio's first transaction or transfer"),
    to: dateRange().to.describe('Last day (YYYY-MM-DD). Default and maximum: today'),
  },
  run: ({ userId, args }) => {
    const { from, to } = withDateOrder(z.object(dateRange())).parse({ from: args.from, to: args.to });
    return getPortfolioValueHistory({ userId, portfolioId: args.portfolioId, from, to });
  },
});
