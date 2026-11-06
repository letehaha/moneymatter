import { dateString, recordId } from '@common/lib/zod/custom-types';
import { listPortfolioTransfers } from '@services/investments/portfolios/transfers';
import { z } from 'zod';

import { defineTool } from '../define-tool';
import { slimPortfolioTransferForMcp } from '../serializers';

export const listPortfolioTransfersTool = defineTool({
  name: 'list_portfolio_transfers',
  toolset: 'investments',
  access: 'read',
  description:
    'Cash movement history of a portfolio: account↔portfolio transfers, direct deposits/withdrawals, linked bank transactions, and currency exchanges. Each entry names the source/destination portfolio or account. Sorted by date, newest first. Returns { transfers, totalCount }.',
  input: {
    portfolioId: recordId().describe('Portfolio ID (from get_portfolios)'),
    from: dateString().optional().describe('Only transfers on or after this date (YYYY-MM-DD)'),
    to: dateString().optional().describe('Only transfers on or before this date (YYYY-MM-DD)'),
    limit: z.number().int().positive().max(100).optional().describe('Max results to return (default: 20)'),
    offset: z.number().int().min(0).optional().describe('Pagination offset (default: 0)'),
  },
  run: async ({ userId, args }) => {
    const { data, totalCount } = await listPortfolioTransfers({
      userId,
      portfolioId: args.portfolioId,
      from: args.from,
      to: args.to,
      limit: args.limit,
      offset: args.offset,
    });

    return { transfers: data.map(slimPortfolioTransferForMcp), totalCount };
  },
});
