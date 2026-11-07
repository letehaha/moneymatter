import { recordId } from '@common/lib/zod/custom-types';
import { suggestHistoricalMatches } from '@services/subscriptions/suggest-historical-matches';

import { defineTool } from '../define-tool';
import { presentTransactions } from './transaction-output';

export const listSubscriptionMatchSuggestionsTool = defineTool({
  name: 'list_subscription_match_suggestions',
  toolset: 'subscriptions',
  access: 'read',
  description:
    'List past transactions (the last 12 months, at most 100, newest first) that a subscription’s matching rules would match but that are not linked to it yet. Returns an empty list when the subscription has no usable rules. Link the right ones with link_transactions_to_subscription. Reads only.',
  input: {
    subscriptionId: recordId().describe('ID of the subscription whose matching rules to run'),
  },
  run: async ({ userId, args }) => {
    const transactions = await suggestHistoricalMatches({ subscriptionId: args.subscriptionId, userId });
    const suggestions = await presentTransactions({ userId, transactions });

    return { suggestions, total: suggestions.length };
  },
});
