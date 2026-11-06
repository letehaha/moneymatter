import { recordId } from '@common/lib/zod/custom-types';
import { deleteTrackerLine } from '@services/trackers/lines/delete-line';

import { defineTool } from '../define-tool';

export const deleteTrackerLineTool = defineTool({
  name: 'delete_tracker_line',
  toolset: 'trackers',
  access: 'delete',
  description:
    'Permanently delete a line from a tracker. Transactions are kept; their spending moves to the next matching line or to "other". Requires manage access to the tracker. Returns { success: true } on completion.',
  input: {
    trackerId: recordId().describe('ID of the tracker the line belongs to'),
    lineId: recordId().describe('ID of the line to delete'),
  },
  run: async ({ userId, args }) => {
    await deleteTrackerLine({
      userId,
      trackerId: args.trackerId,
      lineId: args.lineId,
    });

    return { success: true };
  },
});
