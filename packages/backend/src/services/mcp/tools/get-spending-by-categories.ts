import { TRANSACTION_TYPES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { getSpendingsByCategoriesReport } from '@services/stats/reports/spendings-by-categories.report';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const getSpendingByCategoriesTool = defineTool({
  name: 'get_spending_by_categories',
  toolset: 'core',
  access: 'read',
  description:
    'Get spending breakdown by category for a date range. Returns each category with its total amount. Great for understanding where money goes. Defaults to current month expenses.',
  input: {
    startDate: z.string().optional().describe('Start date (ISO 8601). Default: start of current month'),
    endDate: z.string().optional().describe('End date (ISO 8601). Default: today'),
    accountId: recordId().optional().describe('Filter by specific account ID'),
    transactionType: z
      .enum([TRANSACTION_TYPES.income, TRANSACTION_TYPES.expense])
      .optional()
      .describe('Transaction type. Default: expense'),
    categoryIds: z.array(recordId()).optional().describe('Only include specific category IDs'),
    excludedCategoryIds: z.array(recordId()).optional().describe('Exclude specific category IDs'),
  },
  run: async ({ userId, args }) => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const serialized = await getSpendingsByCategoriesReport({
      userId,
      from: args.startDate ?? startOfMonth.toISOString(),
      to: args.endDate ?? now.toISOString(),
      accountId: args.accountId,
      transactionType: args.transactionType,
      categoryIds: args.categoryIds,
      excludedCategoryIds: args.excludedCategoryIds,
    });

    // Convert from object keyed by ID to an array for easier AI consumption
    const categories = Object.entries(serialized).map(([id, data]) => ({
      id,
      ...data,
    }));

    const total = categories.reduce((sum, c) => sum.add(Money.fromDecimal(c.amount)), Money.zero()).toNumber();

    return {
      period: {
        startDate: args.startDate ?? startOfMonth.toISOString().split('T')[0],
        endDate: args.endDate ?? now.toISOString().split('T')[0],
      },
      categories,
      total,
    };
  },
});
