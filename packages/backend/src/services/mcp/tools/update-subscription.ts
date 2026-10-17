import { SUBSCRIPTION_FREQUENCIES, SUBSCRIPTION_TYPES } from '@bt/shared/types';
import { currencyCode, recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { updateSubscription } from '@services/subscriptions';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  id: z.string().describe('UUID of the subscription to update'),
  name: z.string().optional().describe('New display name'),
  frequency: z
    .enum([
      SUBSCRIPTION_FREQUENCIES.weekly,
      SUBSCRIPTION_FREQUENCIES.biweekly,
      SUBSCRIPTION_FREQUENCIES.monthly,
      SUBSCRIPTION_FREQUENCIES.quarterly,
      SUBSCRIPTION_FREQUENCIES.semiAnnual,
      SUBSCRIPTION_FREQUENCIES.annual,
    ])
    .optional()
    .describe('New billing frequency'),
  startDate: z.string().optional().describe('New start date (ISO 8601)'),
  type: z
    .enum([SUBSCRIPTION_TYPES.subscription, SUBSCRIPTION_TYPES.bill, SUBSCRIPTION_TYPES.installment])
    .optional()
    .describe(
      'New type: "subscription", "bill", or "installment". Switching to installment requires maxOccurrences and dueDate to be set (pass them in the same call).',
    ),
  expectedAmount: z.number().nullable().optional().describe('New expected payment amount as a decimal (e.g. 9.99)'),
  expectedCurrencyCode: currencyCode().nullable().optional().describe('New currency code for expectedAmount'),
  endDate: z.string().nullable().optional().describe('New end date (ISO 8601), or null to clear'),
  dueDate: z
    .string()
    .nullable()
    .optional()
    .describe('New first/next payment date (ISO 8601), or null to clear the schedule'),
  maxOccurrences: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe('New total number of payments, or null for an indefinite schedule'),
  accountId: recordId().nullable().optional().describe('New account ID, or null to clear'),
  categoryId: recordId().nullable().optional().describe('New category ID, or null to clear'),
  notes: z.string().nullable().optional().describe('New notes, or null to clear'),
  isActive: z.boolean().optional().describe('Active state (prefer toggle_subscription_active instead)'),
};

export function registerUpdateSubscription(server: McpServer) {
  server.registerTool(
    'update_subscription',
    {
      description:
        'Update fields on an existing subscription or bill. Only provided fields are changed. To toggle active state use toggle_subscription_active instead. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'update_subscription', clientId: extra.authInfo?.clientId });

      const { id, ...fields } = args;

      const result = await updateSubscription({ id, userId, ...fields });

      return jsonContent({ data: result });
    },
  );
}
