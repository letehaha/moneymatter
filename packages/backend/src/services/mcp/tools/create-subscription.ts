import { SUBSCRIPTION_FREQUENCIES, SUBSCRIPTION_TYPES, TRANSACTION_TYPES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createSubscription } from '@services/subscriptions';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  name: z.string().describe('Display name of the subscription (e.g. "Netflix", "Electricity")'),
  frequency: z
    .enum([
      SUBSCRIPTION_FREQUENCIES.weekly,
      SUBSCRIPTION_FREQUENCIES.biweekly,
      SUBSCRIPTION_FREQUENCIES.monthly,
      SUBSCRIPTION_FREQUENCIES.quarterly,
      SUBSCRIPTION_FREQUENCIES.semiAnnual,
      SUBSCRIPTION_FREQUENCIES.annual,
    ])
    .describe('Billing frequency: weekly, biweekly, monthly, quarterly, semi_annual, annual'),
  startDate: z.string().describe('Start date of the subscription (ISO 8601, e.g. "2024-01-01")'),
  type: z
    .enum([SUBSCRIPTION_TYPES.subscription, SUBSCRIPTION_TYPES.bill, SUBSCRIPTION_TYPES.installment])
    .optional()
    .describe('Type: "subscription" (default), "bill", or "installment"'),
  transactionType: z
    .enum([TRANSACTION_TYPES.expense, TRANSACTION_TYPES.income])
    .optional()
    .describe('Transaction type: "expense" (default) or "income"'),
  expectedAmount: z
    .number()
    .nullable()
    .optional()
    .describe('Expected payment amount as a decimal (e.g. 9.99). Use with expectedCurrencyCode'),
  expectedCurrencyCode: z
    .string()
    .nullable()
    .optional()
    .describe('Currency code for expectedAmount (e.g. "USD", "EUR")'),
  endDate: z.string().nullable().optional().describe('End date if the subscription is finite (ISO 8601)'),
  dueDate: z
    .string()
    .nullable()
    .optional()
    .describe('First payment date (ISO 8601). Required for installments; enables a payment schedule.'),
  maxOccurrences: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe('Total number of payments. Required for installments; null/omitted means an indefinite schedule.'),
  accountId: recordId().nullable().optional().describe('Account ID to associate with this subscription'),
  categoryId: recordId().nullable().optional().describe('Category ID to associate with this subscription'),
  notes: z.string().nullable().optional().describe('Additional notes about the subscription'),
};

export function registerCreateSubscription(server: McpServer) {
  server.registerTool(
    'create_subscription',
    {
      description:
        'Create a new subscription, recurring bill, or installment plan. Use type="subscription" for SaaS/streaming services, type="bill" for utilities, and type="installment" for a finite financed purchase paid off over a fixed number of payments. An installment requires maxOccurrences (number of payments) and dueDate (first payment date). expectedAmount is a decimal in the subscription currency. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_subscription', clientId: extra.authInfo?.clientId });

      const result = await createSubscription({
        userId,
        name: args.name,
        frequency: args.frequency,
        startDate: args.startDate,
        type: args.type,
        transactionType: args.transactionType,
        expectedAmount: args.expectedAmount,
        expectedCurrencyCode: args.expectedCurrencyCode,
        endDate: args.endDate,
        dueDate: args.dueDate,
        maxOccurrences: args.maxOccurrences,
        accountId: args.accountId,
        categoryId: args.categoryId,
        notes: args.notes,
      });

      return jsonContent({ data: result });
    },
  );
}
