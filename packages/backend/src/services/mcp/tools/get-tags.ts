import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTagById } from '@services/tags/get-tag-by-id';
import { getTags } from '@services/tags/get-tags';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  tagId: recordId().optional().describe('Tag id. When given, returns that one tag with its description.'),
};

export function registerGetTags(server: McpServer) {
  server.registerTool(
    'get_tags',
    {
      description:
        'List all user tags. Returns tag ID, name, color, and icon. Pass tagId to read one tag, which also includes its description.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_tags', clientId: extra.authInfo?.clientId });

      if (args.tagId) {
        const tag = await getTagById({ id: args.tagId, userId });
        return jsonContent({
          data: { id: tag.id, name: tag.name, color: tag.color, icon: tag.icon, description: tag.description },
        });
      }

      const tags = await getTags({ userId });

      const result = tags.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        icon: t.icon,
      }));

      return jsonContent({ data: result });
    },
  );
}
