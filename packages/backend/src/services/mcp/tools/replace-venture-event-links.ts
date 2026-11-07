import { recordId } from '@common/lib/zod/custom-types';
import { replaceLinksBodySchema } from '@controllers/venture/events/schemas';
import { serializeVentureEventLink } from '@root/serializers';
import { replaceEventLinks } from '@services/venture/linking/replace-event-links.service';

import { defineTool } from '../define-tool';

export const replaceVentureEventLinksTool = defineTool({
  name: 'replace_venture_event_links',
  toolset: 'ventures',
  access: 'write',
  description:
    "Replace the whole set of bank transactions linked to a venture event: every current link is removed (each transaction gets its original state back), then the given transactions are linked under the rules of link_transactions_to_venture_event (same currency, not already linked elsewhere, sum equal to the event's lpNetAmount). An empty transactionIds list only removes the links. All or nothing. Returns the new links.",
  input: {
    eventId: recordId().describe('Venture event ID (from list_venture_events)'),
    transactionIds: replaceLinksBodySchema.shape.transactionIds.describe(
      'IDs of the bank transactions that should back the event from now on (from search_transactions). An empty list unlinks all of them',
    ),
  },
  run: async ({ userId, args }) => {
    const links = await replaceEventLinks({
      userId,
      eventId: args.eventId,
      transactionIds: args.transactionIds,
    });

    return links.map(serializeVentureEventLink);
  },
});
