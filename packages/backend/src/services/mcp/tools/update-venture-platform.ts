import { recordId } from '@common/lib/zod/custom-types';
import { updateVenturePlatformBodyShape, updateVenturePlatformBodySchema } from '@controllers/venture/schemas';
import { updateVenturePlatform } from '@services/venture/platforms/update.service';

import { defineTool } from '../define-tool';

export const updateVenturePlatformTool = defineTool({
  name: 'update_venture_platform',
  toolset: 'ventures',
  access: 'write',
  description:
    "Update an existing venture platform's name, website, description, or default fees. Only provided fields change. Updating default fees does NOT retroactively change fees on existing deals — those are snapshotted at deal creation. Fee fractions are decimals in [0,1].",
  input: {
    platformId: recordId().describe('Venture platform ID (from list_venture_platforms)'),
    name: updateVenturePlatformBodyShape.name.describe('New platform name (must be unique for this user)'),
    website: updateVenturePlatformBodyShape.website.describe('New website URL (pass null to clear)'),
    description: updateVenturePlatformBodyShape.description.describe('New description (pass null to clear)'),
    defaultEntryFeePct: updateVenturePlatformBodyShape.defaultEntryFeePct.describe(
      'New default entry fee as a decimal fraction in [0,1] (e.g. 0.085 for 8.5%).',
    ),
    defaultMgmtFeePct: updateVenturePlatformBodyShape.defaultMgmtFeePct.describe(
      'New default management fee as a decimal fraction in [0,1].',
    ),
    defaultCarryPct: updateVenturePlatformBodyShape.defaultCarryPct.describe(
      'New default carry as a decimal fraction in [0,1] (e.g. 0.2 for 20%).',
    ),
    defaultHurdlePct: updateVenturePlatformBodyShape.defaultHurdlePct.describe(
      'New default hurdle rate as a decimal fraction in [0,1].',
    ),
  },
  // The at-least-one-field rule spans fields, so it runs on the REST body schema.
  validate: ({ args: { platformId, ...fields } }) => ({ platformId, ...updateVenturePlatformBodySchema.parse(fields) }),
  run: ({ userId, args }) => updateVenturePlatform({ userId, ...args }),
});
