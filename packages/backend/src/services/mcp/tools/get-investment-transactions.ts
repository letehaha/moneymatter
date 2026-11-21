import { INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types/investments';
import { recordId } from '@common/lib/zod/custom-types';
import { getTransactions } from '@services/investments/transactions/get.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const getInvestmentTransactionsTool = defineTool({
  name: 'get_investment_transactions',
  toolset: 'investments',
  access: 'read',
  description:
    'Investment transaction history: buy, sell, dividend, transfer, tax, fee, cancel, other. Each transaction includes amount, quantity, price, fees, date, category, and the embedded security. Distinct from search_transactions, which covers regular (non-investment) spending. Default: 20 most recent across all portfolios.',
  input: {
    portfolioId: recordId().optional().describe('Restrict to a specific portfolio'),
    securityId: recordId().optional().describe('Restrict to a specific security'),
    category: z
      .enum([
        INVESTMENT_TRANSACTION_CATEGORY.buy,
        INVESTMENT_TRANSACTION_CATEGORY.sell,
        INVESTMENT_TRANSACTION_CATEGORY.dividend,
        INVESTMENT_TRANSACTION_CATEGORY.transfer,
        INVESTMENT_TRANSACTION_CATEGORY.tax,
        INVESTMENT_TRANSACTION_CATEGORY.fee,
        INVESTMENT_TRANSACTION_CATEGORY.cancel,
        INVESTMENT_TRANSACTION_CATEGORY.other,
      ])
      .optional()
      .describe('Filter by transaction category'),
    startDate: z.string().optional().describe('Start date (ISO 8601)'),
    endDate: z.string().optional().describe('End date (ISO 8601)'),
    limit: z.number().optional().describe('Max results (default: 20)'),
    offset: z.number().optional().describe('Pagination offset (default: 0)'),
  },
  run: ({ userId, args }) =>
    getTransactions({
      userId,
      portfolioId: args.portfolioId,
      securityId: args.securityId,
      category: args.category as INVESTMENT_TRANSACTION_CATEGORY | undefined,
      from: args.startDate,
      to: args.endDate,
      limit: args.limit,
      offset: args.offset,
    }),
});
