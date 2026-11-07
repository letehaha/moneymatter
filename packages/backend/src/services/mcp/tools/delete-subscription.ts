import { deleteSubscription } from '@services/subscriptions';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const deleteSubscriptionTool = defineTool({
  name: 'delete_subscription',
  toolset: 'subscriptions',
  access: 'delete',
  description:
    'Permanently delete a subscription or recurring bill. Linked transaction associations are also removed. This action cannot be undone.',
  input: {
    id: z.string().describe('UUID of the subscription to delete'),
  },
  run: ({ userId, args }) => deleteSubscription({ id: args.id, userId }),
});
