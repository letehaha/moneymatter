import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { unlinkTxFromEvent } from '@services/venture/linking/unlink-tx-from-event.service';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  eventId: recordId().describe('Venture event ID the link belongs to (from list_venture_events)'),
  linkId: recordId().describe('Link ID (from get_venture_event, in its links)'),
};

export function registerDeleteVentureEventLink(server: McpServer) {
  server.registerTool(
    'delete_venture_event_link',
    {
      description:
        "Remove one transaction link from a venture event. The bank transaction is not deleted: the removal restores it to the state it had before it was linked. The event's lpNetAmount is not changed, so the remaining links may no longer add up to it; use replace_venture_event_links to set the whole set at once. Requires finance:delete scope.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_venture_event_link', clientId: extra.authInfo?.clientId });

      await unlinkTxFromEvent({ userId, eventId: args.eventId, linkId: args.linkId });

      return jsonContent({ data: { deleted: true, eventId: args.eventId, linkId: args.linkId } });
    },
  );
}
