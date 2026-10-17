import { CATEGORY_TYPES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createCategory } from '@services/categories/create-category';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  name: z.string().describe('Category name.'),
  color: z.string().optional().describe('Hex color code (e.g. "#4CAF50"). Inherited from parent if omitted.'),
  icon: z.string().nullable().optional().describe('Optional icon identifier for the category.'),
  parentId: recordId().optional().describe('ID of the parent category to create a subcategory.'),
  type: z
    .enum([CATEGORY_TYPES.custom, CATEGORY_TYPES.internal])
    .optional()
    .describe('Category type: "custom" (default, user-editable) or "internal" (system-managed).'),
};

export function registerCreateCategory(server: McpServer) {
  server.registerTool(
    'create_category',
    {
      description:
        'Create a new transaction category. Supports nested categories via parentId — child categories inherit the parent color if none is provided. Use when the user wants a new category to classify transactions.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_category', clientId: extra.authInfo?.clientId });

      const category = await createCategory({ userId, ...args });
      return jsonContent({ data: category });
    },
  );
}
