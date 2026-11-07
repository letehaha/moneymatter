import {
  createSubscriptionBodySchema,
  createSubscriptionBodyShape as shape,
} from '@controllers/subscriptions/shared-schemas';
import { createSubscription } from '@services/subscriptions';

import { defineTool } from '../define-tool';
import { subscriptionExtraInputs, subscriptionMatchingRulesInput } from './subscription-inputs';

export const createSubscriptionTool = defineTool({
  name: 'create_subscription',
  toolset: 'subscriptions',
  access: 'write',
  description:
    'Create a new subscription, recurring bill, or installment plan. Use type="subscription" for SaaS/streaming services, type="bill" for utilities, and type="installment" for a finite financed purchase paid off over a fixed number of payments. An installment requires maxOccurrences (number of payments) and dueDate (first payment date). expectedAmount is a decimal in the subscription currency.',
  input: {
    name: shape.name.describe('Display name of the subscription (e.g. "Netflix", "Electricity")'),
    frequency: shape.frequency.describe('Billing frequency: weekly, biweekly, monthly, quarterly, semi_annual, annual'),
    startDate: shape.startDate.describe('Start date of the subscription (ISO 8601, e.g. "2024-01-01")'),
    type: shape.type.describe('Type: "subscription" (default), "bill", or "installment"'),
    transactionType: shape.transactionType.describe('Transaction type: "expense" (default) or "income"'),
    expectedAmount: shape.expectedAmount.describe(
      'Expected payment amount as a decimal (e.g. 9.99). Use with expectedCurrencyCode',
    ),
    expectedCurrencyCode: shape.expectedCurrencyCode.describe('Currency code for expectedAmount (e.g. "USD", "EUR")'),
    endDate: shape.endDate.describe('End date if the subscription is finite (ISO 8601)'),
    dueDate: shape.dueDate.describe(
      'First payment date (ISO 8601). Required for installments; enables a payment schedule.',
    ),
    maxOccurrences: shape.maxOccurrences.describe(
      'Total number of payments. Required for installments; null/omitted means an indefinite schedule.',
    ),
    accountId: shape.accountId.describe('Account ID to associate with this subscription'),
    categoryId: shape.categoryId.describe('Category ID to associate with this subscription'),
    notes: shape.notes.describe('Additional notes about the subscription'),
    matchingRules: subscriptionMatchingRulesInput,
    ...subscriptionExtraInputs,
  },
  // The amount, installment, auto-record and date-order rules span fields, so they run on the REST schema.
  validate: ({ args }) => createSubscriptionBodySchema.parse(args),
  run: async ({ userId, args }) => {
    const result = await createSubscription({ userId, ...args });

    return result;
  },
});
