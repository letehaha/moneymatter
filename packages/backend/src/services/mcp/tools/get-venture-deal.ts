import { recordId } from '@common/lib/zod/custom-types';
import { getVentureDeal } from '@services/venture/deals/get.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const getVentureDealTool = defineTool({
  name: 'get_venture_deal',
  toolset: 'ventures',
  access: 'read',
  description:
    "Retrieve a single venture deal by id, including its platform and currency. Pass includeEvents=true to also embed the deal's event history (sorted asc). Obtain the dealId from list_venture_deals.",
  input: {
    dealId: recordId().describe('Venture deal ID (from list_venture_deals)'),
    includeEvents: z
      .boolean()
      .optional()
      .describe("When true, embed the deal's event history in the response. Default: false."),
  },
  run: ({ userId, args }) =>
    getVentureDeal({
      userId,
      dealId: args.dealId,
      includeEvents: args.includeEvents,
    }),
});
