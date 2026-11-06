import { recordId } from '@common/lib/zod/custom-types';
import { serializeTracker } from '@root/serializers/trackers.serializer';
import { toggleTrackerArchive } from '@services/trackers/toggle-archive';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const archiveTrackerTool = defineTool({
  name: 'archive_tracker',
  toolset: 'trackers',
  access: 'write',
  description:
    'Archive or unarchive a tracker. Pass isArchived: true to archive (sets status to "archived"), false to restore it to active. Returns the updated tracker.',
  input: {
    trackerId: recordId().describe('ID of the tracker to archive or unarchive'),
    isArchived: z.boolean().describe('true to archive the tracker, false to restore it to active'),
  },
  run: async ({ userId, args }) => {
    const tracker = await toggleTrackerArchive({ id: args.trackerId, userId, isArchived: args.isArchived });

    return serializeTracker(tracker);
  },
});
