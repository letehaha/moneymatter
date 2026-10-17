import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deleteVentureDeal } from '@services/venture/deals/delete.service';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  dealId: recordId().describe('Venture deal ID (from list_venture_deals)'),
  force: z.boolean().optional().describe('If true, hard-delete the deal row. Default: false (soft-delete).'),
};

export function registerDeleteVentureDeal(server: McpServer) {
  server.registerTool(
    'delete_venture_deal',
    {
      description:
        "Delete a venture deal. Cascade-deletes its events and event-link rows. Bank transactions previously linked to the deal's events remain intact in the main transactions list with their original state restored. With force=true the deal row is hard-deleted; otherwise it is soft-deleted. Confirm with the user before calling.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_venture_deal', clientId: extra.authInfo?.clientId });

      const result = await deleteVentureDeal({
        userId,
        dealId: args.dealId,
        force: args.force,
      });

      return jsonContent({ data: result });
    },
  );
}
