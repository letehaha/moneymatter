import { listVenturePlatforms } from '@services/venture/platforms/list.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const listVenturePlatformsTool = defineTool({
  name: 'list_venture_platforms',
  toolset: 'ventures',
  access: 'read',
  description:
    "List the user's venture investment platforms (SPV syndicators, fund managers). Returns each platform's id, name, website, description, and default fee fractions (entry fee, management fee, carry, hurdle). Fee values are decimals in [0,1] — e.g. 0.085 means 8.5%. Use the returned id with get_venture_platform, create_venture_deal, and update_venture_platform.",
  input: {
    limit: z.number().optional().describe('Max results'),
    offset: z.number().optional().describe('Pagination offset (default: 0)'),
  },
  run: ({ userId, args }) => listVenturePlatforms({ userId, limit: args.limit, offset: args.offset }),
});
