import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deleteCategory } from '@services/categories/delete-category';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  categoryId: recordId().describe('ID of the category to delete.'),
  replaceWithCategoryId: z
    .string()
    .uuid()
    .optional()
    .describe('ID of the category to reassign linked transactions to. Required when the category has transactions.'),
};

export function registerDeleteCategory(server: McpServer) {
  server.registerTool(
    'delete_category',
    {
      description:
        'Permanently delete a category by ID. This is destructive — if the category has linked transactions you must supply replaceWithCategoryId to reassign them first, otherwise the call will fail. Cannot delete a parent category that still has subcategories. Check the transaction count with get_category_transaction_count first. Only call when the user explicitly confirms deletion.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_category', clientId: extra.authInfo?.clientId });

      await deleteCategory({ userId, categoryId: args.categoryId, replaceWithCategoryId: args.replaceWithCategoryId });
      return jsonContent({ data: { success: true } });
    },
  );
}
