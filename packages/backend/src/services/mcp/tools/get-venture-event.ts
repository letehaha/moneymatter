import { recordId } from '@common/lib/zod/custom-types';
import { getVentureEvent } from '@services/venture/events/get.service';

import { defineTool } from '../define-tool';

export const getVentureEventTool = defineTool({
  name: 'get_venture_event',
  toolset: 'ventures',
  access: 'read',
  description:
    'Retrieve a single venture event by id, including its link rows (bank transactions linked to this event). Obtain the eventId from list_venture_events.',
  input: {
    eventId: recordId().describe('Venture event ID (from list_venture_events)'),
  },
  run: ({ userId, args }) => getVentureEvent({ userId, eventId: args.eventId }),
});
