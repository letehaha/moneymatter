import { recordId } from '@common/lib/zod/custom-types';
import { countCategoryTransactions } from '@services/categories/count-category-transactions';

import { defineTool } from '../define-tool';

export const getCategoryTransactionCountTool = defineTool({
  name: 'get_category_transaction_count',
  toolset: 'core',
  access: 'read',
  description:
    'Count the transactions filed under a category, planned ones and split lines included. Call it before delete_category: a category with transactions can only be deleted with replaceWithCategoryId, and the count is the number that would be reassigned. A category that does not exist or is not yours (or shared with you) is not found.',
  input: {
    categoryId: recordId().describe('Category id (from get_categories).'),
  },
  run: async ({ userId, args }) => {
    const transactionCount = await countCategoryTransactions({ categoryId: args.categoryId, userId });
    return { categoryId: args.categoryId, transactionCount };
  },
});
