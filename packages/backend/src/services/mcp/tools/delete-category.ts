import { recordId } from '@common/lib/zod/custom-types';
import { deleteCategory } from '@services/categories/delete-category';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const deleteCategoryTool = defineTool({
  name: 'delete_category',
  toolset: 'core',
  access: 'delete',
  description:
    'Permanently delete a category by ID. This is destructive — if the category has linked transactions you must supply replaceWithCategoryId to reassign them first, otherwise the call will fail. Cannot delete a parent category that still has subcategories. Check the transaction count with get_category_transaction_count first. Only call when the user explicitly confirms deletion.',
  input: {
    categoryId: recordId().describe('ID of the category to delete.'),
    replaceWithCategoryId: z
      .string()
      .uuid()
      .optional()
      .describe('ID of the category to reassign linked transactions to. Required when the category has transactions.'),
  },
  run: async ({ userId, args }) => {
    await deleteCategory({ userId, categoryId: args.categoryId, replaceWithCategoryId: args.replaceWithCategoryId });
    return { success: true };
  },
});
