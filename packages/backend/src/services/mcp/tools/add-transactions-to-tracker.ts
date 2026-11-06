import { recordId } from '@common/lib/zod/custom-types';
import { addTransactionsToTracker } from '@services/trackers/add-transactions-to-tracker';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const addTransactionsToTrackerTool = defineTool({
  name: 'add_transactions_to_tracker',
  toolset: 'trackers',
  access: 'write',
  description:
    'Manually link one or more transactions to a tracker, alongside any links its category and tag rules add. Returns a success message on completion.',
  input: {
    trackerId: recordId().describe('ID of the tracker to link transactions to'),
    transactionIds: z.array(recordId()).describe('IDs of the transactions to add to the tracker'),
  },
  run: ({ userId, args }) =>
    addTransactionsToTracker({
      trackerId: args.trackerId,
      userId,
      transactionIds: args.transactionIds,
    }),
});
