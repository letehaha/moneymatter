import { slimSubscriptionDetailForMcp } from '@services/mcp/serializers';
import { getSubscriptionById } from '@services/subscriptions';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const getSubscriptionByIdTool = defineTool({
  name: 'get_subscription_by_id',
  toolset: 'subscriptions',
  access: 'read',
  description:
    'Retrieve a single subscription by its ID including all linked transactions (with match source and date) and the computed next expected payment date.',
  input: {
    id: z.string().describe('UUID of the subscription to retrieve'),
  },
  run: async ({ userId, args }) => {
    const result = await getSubscriptionById({ id: args.id, userId });

    return slimSubscriptionDetailForMcp(result);
  },
});
