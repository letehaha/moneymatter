import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deleteVenturePlatform } from '@services/venture/platforms/delete.service';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  platformId: recordId().describe('Venture platform ID (from list_venture_platforms)'),
  force: z.boolean().optional().describe('If true, hard-delete the platform. Default: false (soft-delete).'),
};

export function registerDeleteVenturePlatform(server: McpServer) {
  server.registerTool(
    'delete_venture_platform',
    {
      description:
        "Delete a venture platform. Existing deals that reference it have their platformId cleared (deals are preserved). With force=true, hard-deletes the platform; otherwise it is soft-deleted. Confirm with the user before calling — operates against the user's records.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_venture_platform', clientId: extra.authInfo?.clientId });

      const result = await deleteVenturePlatform({
        userId,
        platformId: args.platformId,
        force: args.force,
      });

      return jsonContent({ data: result });
    },
  );
}
