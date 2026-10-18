import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { countCategoryTransactions } from '@services/categories/count-category-transactions';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  categoryId: recordId().describe('Category id (from get_categories).'),
};

export function registerGetCategoryTransactionCount(server: McpServer) {
  server.registerTool(
    'get_category_transaction_count',
    {
      description:
        'Count the transactions filed under a category, planned ones and split lines included. Call it before delete_category: a category with transactions can only be deleted with replaceWithCategoryId, and the count is the number that would be reassigned. An unknown category counts 0.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_category_transaction_count', clientId: extra.authInfo?.clientId });

      const transactionCount = await countCategoryTransactions({ categoryId: args.categoryId, userId });
      return jsonContent({ data: { categoryId: args.categoryId, transactionCount } });
    },
  );
}
