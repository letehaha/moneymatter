import { recordId } from '@common/lib/zod/custom-types';
import { unlinkTxFromEvent } from '@services/venture/linking/unlink-tx-from-event.service';

import { defineTool } from '../define-tool';

export const deleteVentureEventLinkTool = defineTool({
  name: 'delete_venture_event_link',
  toolset: 'ventures',
  access: 'delete',
  description:
    "Remove one transaction link from a venture event. The bank transaction is not deleted: the removal restores it to the state it had before it was linked. The event's lpNetAmount is not changed. To set the whole set at once, use replace_venture_event_links.",
  input: {
    eventId: recordId().describe('Venture event ID the link belongs to (from list_venture_events)'),
    linkId: recordId().describe('Link ID (from get_venture_event, in its links)'),
  },
  run: async ({ userId, args }) => {
    await unlinkTxFromEvent({ userId, eventId: args.eventId, linkId: args.linkId });

    return { deleted: true, eventId: args.eventId, linkId: args.linkId };
  },
});
