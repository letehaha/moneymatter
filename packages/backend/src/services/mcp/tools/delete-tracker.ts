import { recordId } from '@common/lib/zod/custom-types';
import { deleteTracker } from '@services/trackers/delete-tracker';

import { defineTool } from '../define-tool';

export const deleteTrackerTool = defineTool({
  name: 'delete_tracker',
  toolset: 'trackers',
  access: 'delete',
  description:
    'Permanently delete a tracker and all its transaction links. This action cannot be undone. Returns { success: true } on completion.',
  input: {
    trackerId: recordId().describe('ID of the tracker to delete'),
  },
  run: ({ userId, args }) => deleteTracker({ id: args.trackerId, userId }),
});
