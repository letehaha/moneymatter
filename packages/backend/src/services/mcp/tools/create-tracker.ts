import {
  TRACKER_STATUSES,
  TRACKER_TYPES,
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
  type: z
    .enum([TRACKER_TYPES.manual, TRACKER_TYPES.category])
    .optional()
    .describe(
      'Tracker type: manual (transactions linked explicitly) or category (auto-tracks by category). Default: manual',
    ),
  categoryIds: z.array(recordId()).optional().describe('Category IDs to link (only used when type is "category")'),
  startDate: z.string().optional().describe('Tracker start date (ISO 8601)'),
  endDate: z.string().optional().describe('Tracker end date (ISO 8601)'),
  autoInclude: z
    .boolean()
    .optional()
    .describe('Auto-include transactions in the date range when creating (manual trackers only)'),
  limitAmount: z
    .number()
    .optional()
    .describe("Spending limit as a decimal amount in the user's base currency (e.g. 500.00)"),
  aiEnabled: smartTrackingFieldsShape.aiEnabled.describe(
    'Turn on smart tracking: an AI scans the date range and links or suggests matching transactions. Manual trackers only; requires aiDescription and startDate',
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
        'Create a tracker with an optional spending limit, date range, and linked categories. It does not create or change the period-based Budget plan. Set aiEnabled with aiDescription and startDate to turn on smart tracking (manual trackers only); review its suggestions with list_tracker_suggestions. Returns the created tracker with its ID, status, type, and associated categories.',
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
        type: args.type,
        categoryIds: args.categoryIds,
        startDate: args.startDate ? new Date(args.startDate) : undefined,
        endDate: args.endDate ? new Date(args.endDate) : undefined,
        autoInclude: args.autoInclude,
        limitAmount: args.limitAmount !== undefined ? Money.fromDecimal(args.limitAmount) : undefined,
        aiEnabled: args.aiEnabled,
        aiDescription: args.aiDescription,
        aiPreWindowDays: args.aiPreWindowDays,
      });

      return jsonContent({ data: serializeTracker(tracker) });
    },
  );
}
