import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deleteVentureEvent } from '@services/venture/events/delete.service';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  eventId: recordId().describe('Venture event ID (from list_venture_events)'),
  deleteLinkedTransactions: z
    .boolean()
    .optional()
    .describe('If true, also delete the bank transaction rows that were linked. Default: false (unlink only).'),
};

export function registerDeleteVentureEvent(server: McpServer) {
  server.registerTool(
    'delete_venture_event',
    {
      description:
        'Delete a venture event. Linked bank transactions are unlinked first (their original state is restored). The initial_investment cannot be deleted while other events still exist on the deal — delete the other events first. Pass deleteLinkedTransactions=true to also remove the bank tx rows themselves (not just the link); only do this when the user explicitly asks. Confirm with the user before calling.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_venture_event', clientId: extra.authInfo?.clientId });

      const result = await deleteVentureEvent({
        userId,
        eventId: args.eventId,
        deleteLinkedTransactions: args.deleteLinkedTransactions,
      });

      return jsonContent({ data: result });
    },
  );
}
