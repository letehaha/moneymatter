import { recordId, uniqueRecordIds } from '@common/lib/zod/custom-types';
import { resolveTrackerSuggestions } from '@services/trackers/smart-tracking/resolve-suggestions';

import { defineTool } from '../define-tool';

export const acceptTrackerSuggestionsTool = defineTool({
  name: 'accept_tracker_suggestions',
  toolset: 'trackers',
  access: 'write',
  description:
    'Accept pending smart-tracking suggestions of a tracker the user owns: each suggested transaction is linked to the tracker. Suggestion ids come from list_tracker_suggestions; fails if any is not pending. Returns resolvedCount.',
  input: {
    trackerId: recordId().describe('ID of a tracker the user owns'),
    suggestionIds: uniqueRecordIds({ min: 1 }).describe('Suggestion IDs from list_tracker_suggestions'),
  },
  run: ({ userId, args }) =>
    resolveTrackerSuggestions({
      userId,
      trackerId: args.trackerId,
      suggestionIds: args.suggestionIds,
      action: 'accept',
    }),
});
