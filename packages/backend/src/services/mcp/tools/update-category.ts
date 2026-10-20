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
  parentId: recordId()
    .nullable()
    .optional()
    .describe('Move under this parent category ID, or null to make it top-level. Omit to keep it where it is'),
  defaultTagIds: z
    .array(recordId())
    .max(20)
    .optional()
    .describe('Replaces the default tags (IDs from get_tags); [] clears them. Max 20'),
  applyDefaultTagsOnAiCategorization: z
    .boolean()
    .optional()
    .describe('true also applies defaultTagIds when AI categorization picks this category'),
};

export function registerUpdateCategory(server: McpServer) {
  server.registerTool(
    'update_category',
    {
      description:
        'Update an existing category by ID. Use when the user wants to rename, recolor, re-icon, move or set the default tags of a category. Returns the updated category records.',
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
