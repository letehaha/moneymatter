import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { updateTag } from '@services/tags/update-tag';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  id: recordId().describe('ID of the tag to update.'),
  name: z.string().optional().describe('New tag name (must be unique for this user).'),
  color: z.string().optional().describe('New hex color code for the tag (e.g. "#FF5733").'),
  icon: z.string().nullable().optional().describe('New icon identifier, or null to clear it.'),
  description: z.string().nullable().optional().describe('New description, or null to clear it.'),
};

export function registerUpdateTag(server: McpServer) {
  server.registerTool(
    'update_tag',
    {
      description:
        'Update an existing tag by ID. Use when the user wants to rename, recolor, or change the icon/description of a tag. Returns the updated tag.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'update_tag', clientId: extra.authInfo?.clientId });

      const tag = await updateTag({ userId, ...args });
      return jsonContent({ data: tag });
    },
  );
}
