import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createTag } from '@services/tags/create-tag';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  name: z.string().describe('Tag name (must be unique for this user).'),
  color: z.string().describe('Hex color code for the tag (e.g. "#FF5733").'),
  icon: z.string().optional().describe('Optional icon identifier for the tag.'),
  description: z.string().optional().describe('Optional description of the tag.'),
};

export function registerCreateTag(server: McpServer) {
  server.registerTool(
    'create_tag',
    {
      description:
        'Create a new tag that can be assigned to transactions. Use when the user wants to label or categorize transactions with a custom tag. Returns the created tag with its ID.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_tag', clientId: extra.authInfo?.clientId });

      const tag = await createTag({ userId, ...args });
      return jsonContent({ data: tag });
    },
  );
}
