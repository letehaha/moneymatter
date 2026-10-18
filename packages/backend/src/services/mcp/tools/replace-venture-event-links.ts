import { recordId } from '@common/lib/zod/custom-types';
import { replaceLinksBodySchema } from '@controllers/venture/events/schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeVentureEventLink } from '@root/serializers';
import { replaceEventLinks } from '@services/venture/linking/replace-event-links.service';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  eventId: recordId().describe('Venture event ID (from list_venture_events)'),
  transactionIds: replaceLinksBodySchema.shape.transactionIds.describe(
    'IDs of the bank transactions that should back the event from now on (from search_transactions). An empty list unlinks all of them',
  ),
};

export function registerReplaceVentureEventLinks(server: McpServer) {
  server.registerTool(
    'replace_venture_event_links',
    {
      description:
        "Replace the whole set of bank transactions linked to a venture event: every current link is removed (each transaction gets its original state back), then the given transactions are linked under the rules of link_transactions_to_venture_event (same currency, not already linked elsewhere, sum equal to the event's lpNetAmount). An empty transactionIds list only removes the links. All or nothing. Returns the new links. Requires finance:write scope.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'replace_venture_event_links', clientId: extra.authInfo?.clientId });

      const links = await replaceEventLinks({
        userId,
        eventId: args.eventId,
        transactionIds: args.transactionIds,
      });

      return jsonContent({ data: links.map(serializeVentureEventLink) });
    },
  );
}
