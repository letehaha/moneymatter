import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { editCategory } from '@services/categories/edit-category';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  categoryId: recordId().describe('ID of the category to update.'),
  name: z.string().optional().describe('New category name.'),
  color: z.string().optional().describe('New hex color code (e.g. "#4CAF50").'),
  icon: z.string().nullable().optional().describe('New icon identifier, or null to clear it.'),
};

export function registerUpdateCategory(server: McpServer) {
  server.registerTool(
    'update_category',
    {
      description:
        'Update an existing category by ID. Use when the user wants to rename, recolor, or change the icon of a category. Returns the updated category records.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'update_category', clientId: extra.authInfo?.clientId });

      const result = await editCategory({ userId, ...args });
      return jsonContent({ data: result });
    },
  );
}
