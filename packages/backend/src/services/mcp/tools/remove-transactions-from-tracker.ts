import { recordId } from '@common/lib/zod/custom-types';
import { removeTransactionsFromTracker } from '@services/trackers/remove-transactions-from-tracker';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const removeTransactionsFromTrackerTool = defineTool({
  name: 'remove_transactions_from_tracker',
  toolset: 'trackers',
  access: 'write',
  description:
    'Unlink one or more transactions from a tracker. Does not delete the transactions themselves. Returns nothing on success.',
  input: {
    trackerId: recordId().describe('ID of the tracker to unlink transactions from'),
    transactionIds: z.array(recordId()).describe('IDs of the transactions to remove from the tracker'),
  },
  run: async ({ userId, args }) => {
    await removeTransactionsFromTracker({
      trackerId: args.trackerId,
      userId,
      transactionIds: args.transactionIds,
    });

    return { success: true };
  },
});
