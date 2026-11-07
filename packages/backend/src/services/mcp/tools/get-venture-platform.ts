import { recordId } from '@common/lib/zod/custom-types';
import { getVenturePlatform } from '@services/venture/platforms/get.service';

import { defineTool } from '../define-tool';

export const getVenturePlatformTool = defineTool({
  name: 'get_venture_platform',
  toolset: 'ventures',
  access: 'read',
  description:
    'Retrieve a single venture platform by id. Returns full record including default fee fractions (decimals in [0,1]). Obtain the platformId from list_venture_platforms.',
  input: {
    platformId: recordId().describe('Venture platform ID (from list_venture_platforms)'),
  },
  run: ({ userId, args }) => getVenturePlatform({ userId, platformId: args.platformId }),
});
