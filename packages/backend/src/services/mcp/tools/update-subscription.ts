import {
  updateSubscriptionBodySchema,
  updateSubscriptionBodyShape as shape,
} from '@controllers/subscriptions/shared-schemas';
import { updateSubscription } from '@services/subscriptions';
import { z } from 'zod';

import { defineTool } from '../define-tool';
import { subscriptionExtraInputs, subscriptionMatchingRulesUpdateInput } from './subscription-inputs';

export const updateSubscriptionTool = defineTool({
  name: 'update_subscription',
  toolset: 'subscriptions',
  access: 'write',
  description:
    'Update fields on an existing subscription or bill. Only provided fields are changed; matchingRules, tagIds and remindBefore replace the stored list. To toggle active state use toggle_subscription_active instead.',
  input: {
    id: z.string().describe('UUID of the subscription to update'),
    name: shape.name.describe('New display name'),
    frequency: shape.frequency.describe(
      'New billing frequency: weekly, biweekly, monthly, quarterly, semi_annual, annual, or custom (needs intervalUnit and intervalCount unless already custom)',
    ),
    intervalUnit: shape.intervalUnit.describe(
      'New unit of a custom frequency: day, week, month or year. Only for a custom frequency',
    ),
    intervalCount: shape.intervalCount.describe(
      'New count of a custom frequency (day up to 366, week 104, month 120, year 10). Only for a custom frequency',
    ),
    startDate: shape.startDate.describe('New start date (ISO 8601)'),
    type: shape.type.describe(
      'New type: "subscription", "bill", or "installment". Switching to installment requires maxOccurrences and dueDate to be set (pass them in the same call).',
    ),
    expectedAmount: shape.expectedAmount.describe('New expected payment amount as a decimal (e.g. 9.99)'),
    expectedCurrencyCode: shape.expectedCurrencyCode.describe('New currency code for expectedAmount'),
    endDate: shape.endDate.describe('New end date (ISO 8601), or null to clear'),
    dueDate: shape.dueDate.describe('New first/next payment date (ISO 8601), or null to clear the schedule'),
    maxOccurrences: shape.maxOccurrences.describe('New total number of payments, or null for an indefinite schedule'),
    accountId: shape.accountId.describe('New account ID, or null to clear'),
    categoryId: shape.categoryId.describe('New category ID, or null to clear'),
    notes: shape.notes.describe('New notes, or null to clear'),
    matchingRules: subscriptionMatchingRulesUpdateInput,
    ...subscriptionExtraInputs,
    isActive: shape.isActive.describe('Active state (prefer toggle_subscription_active instead)'),
  },
  run: ({ userId, args }) => {
    const { id, ...fields } = args;
    const body = updateSubscriptionBodySchema.parse(fields);

    return updateSubscription({ id, userId, ...body });
  },
});
