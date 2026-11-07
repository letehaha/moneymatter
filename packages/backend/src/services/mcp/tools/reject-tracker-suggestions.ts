import { recordId, uniqueRecordIds } from '@common/lib/zod/custom-types';
import { resolveTrackerSuggestions } from '@services/trackers/smart-tracking/resolve-suggestions';

import { defineTool } from '../define-tool';

export const rejectTrackerSuggestionsTool = defineTool({
  name: 'reject_tracker_suggestions',
  toolset: 'trackers',
  access: 'write',
  description:
    'Reject smart-tracking suggestions of a tracker the user owns: pending ones are dismissed, and AI-linked or accepted ones are also unlinked from the tracker. The AI will not suggest these transactions again. Suggestion ids come from list_tracker_suggestions (pending or aiMatched). Returns resolvedCount.',
  input: {
    trackerId: recordId().describe('ID of a tracker the user owns'),
    suggestionIds: uniqueRecordIds({ min: 1 }).describe('Suggestion IDs from list_tracker_suggestions'),
  },
  run: ({ userId, args }) =>
    resolveTrackerSuggestions({
      userId,
      trackerId: args.trackerId,
      suggestionIds: args.suggestionIds,
      action: 'reject',
    }),
});
