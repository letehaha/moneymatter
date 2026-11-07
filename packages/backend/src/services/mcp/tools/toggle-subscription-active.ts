import { toggleSubscriptionActive } from '@services/subscriptions';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const toggleSubscriptionActiveTool = defineTool({
  name: 'toggle_subscription_active',
  toolset: 'subscriptions',
  access: 'write',
  description:
    'Activate or deactivate a subscription. Inactive subscriptions are excluded from upcoming payment calculations and summary totals.',
  input: {
    id: z.string().describe('UUID of the subscription'),
    isActive: z.boolean().describe('True to activate the subscription, false to deactivate it'),
  },
  run: ({ userId, args }) => toggleSubscriptionActive({ id: args.id, userId, isActive: args.isActive }),
});
