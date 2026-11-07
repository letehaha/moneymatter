import { recordId } from '@common/lib/zod/custom-types';
import { serializeTransactions } from '@root/serializers/transactions.serializer';
import { getTrackerSuggestions } from '@services/trackers/smart-tracking/get-suggestions';

import { defineTool } from '../define-tool';
import { presentTransactions } from './transaction-output';

export const listTrackerSuggestionsTool = defineTool({
  name: 'list_tracker_suggestions',
  toolset: 'trackers',
  access: 'read',
  description:
    'Smart-tracking state of a tracker the user owns. pending: transactions the AI suggests linking, each with a suggestion id, score (0-1), the AI reason, and a transaction summary; accept or reject them by suggestion id with accept_tracker_suggestions / reject_tracker_suggestions. aiMatched: transactions the AI linked or the user accepted, still linked, with their reason. scan: status (idle, queued, running), startedAt, lastScannedAt, and pausedReason (archived, no_start_date, ended, plan, allowance, unavailable) when scanning cannot run; plan means the plan does not include smart tracking and the user has no AI connection of their own.',
  input: { trackerId: recordId().describe('ID of a tracker the user owns') },
  run: async ({ userId, args }) => {
    const { rejected: _rejected, ...result } = await getTrackerSuggestions({ userId, trackerId: args.trackerId });
    const transactions = await presentTransactions({
      userId,
      transactions: serializeTransactions(result.pending.map((s) => s.transaction)),
    });

    return { ...result, pending: result.pending.map((s, index) => ({ ...s, transaction: transactions[index] })) };
  },
});
