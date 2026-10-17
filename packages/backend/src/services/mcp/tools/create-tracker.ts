import {
  TRACKER_STATUSES,
  TRACKER_AI_DEFAULT_PRE_WINDOW_DAYS,
  TRACKER_AI_DESCRIPTION_MAX_LENGTH,
  TRACKER_AI_PRE_WINDOW_DAYS,
} from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { smartTrackingFieldsShape } from '@controllers/trackers/smart-tracking-fields.schema';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeTracker } from '@root/serializers/trackers.serializer';
import { createTracker } from '@services/trackers/create-tracker';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  name: z.string().describe('Tracker name'),
  status: z
    .enum([TRACKER_STATUSES.active, TRACKER_STATUSES.archived, TRACKER_STATUSES.closed])
    .optional()
    .describe('Tracker status (default: active)'),
  rulesEnabled: z
    .boolean()
    .optional()
    .describe(
      "Auto-add the user's transactions in the date range matching any of categoryIds or tagIds. Needs at least one of them. Default: false",
    ),
  categoryIds: z.array(recordId()).optional().describe('Rule categories; parent IDs include their children'),
  tagIds: z.array(recordId()).optional().describe('Rule tags'),
  rulesCleanup: z
    .boolean()
    .optional()
    .describe('Remove rule-added transactions that stop matching the rules. Default: true'),
  startDate: z.string().optional().describe('Tracker start date (ISO 8601)'),
  endDate: z.string().optional().describe('Tracker end date (ISO 8601)'),
  limitAmount: z
    .number()
    .optional()
    .describe("Spending limit as a decimal amount in the user's base currency (e.g. 500.00)"),
  aiEnabled: smartTrackingFieldsShape.aiEnabled.describe(
    'Turn on smart tracking: an AI scans the date range and links or suggests matching transactions. Requires aiDescription and startDate',
  ),
  aiDescription: smartTrackingFieldsShape.aiDescription.describe(
    `Plain-language description of what belongs in the tracker (max ${TRACKER_AI_DESCRIPTION_MAX_LENGTH} chars), e.g. "Trip to Lisbon: flights, hotels, food"`,
  ),
  aiPreWindowDays: smartTrackingFieldsShape.aiPreWindowDays.describe(
    `Days before startDate the AI also scans, for things booked in advance. One of ${TRACKER_AI_PRE_WINDOW_DAYS.join(', ')}. Default: ${TRACKER_AI_DEFAULT_PRE_WINDOW_DAYS}`,
  ),
};

export function registerCreateTracker(server: McpServer) {
  server.registerTool(
    'create_tracker',
    {
      description:
        'Create a tracker with an optional spending limit and date range. It does not create or change the period-based Budget plan. Set rulesEnabled with categoryIds and/or tagIds to auto-add matching transactions; link others with add_transactions_to_tracker. Set aiEnabled with aiDescription and startDate to turn on smart tracking; review its suggestions with list_tracker_suggestions. Returns the created tracker with its ID, status, rule categories and tags.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_tracker', clientId: extra.authInfo?.clientId });

      const tracker = await createTracker({
        userId,
        name: args.name,
        status: args.status ?? TRACKER_STATUSES.active,
        rulesEnabled: args.rulesEnabled,
        rulesCleanup: args.rulesCleanup,
        categoryIds: args.categoryIds,
        tagIds: args.tagIds,
        startDate: args.startDate ? new Date(args.startDate) : undefined,
        endDate: args.endDate ? new Date(args.endDate) : undefined,
        limitAmount: args.limitAmount !== undefined ? Money.fromDecimal(args.limitAmount) : undefined,
        aiEnabled: args.aiEnabled,
        aiDescription: args.aiDescription,
        aiPreWindowDays: args.aiPreWindowDays,
      });

      return jsonContent({ data: serializeTracker(tracker) });
    },
  );
}
