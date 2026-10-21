import {
  TRACKER_STATUSES,
  TRACKER_AI_DEFAULT_PRE_WINDOW_DAYS,
  TRACKER_AI_DESCRIPTION_MAX_LENGTH,
  TRACKER_AI_PRE_WINDOW_DAYS,
} from '@bt/shared/types';
import { createTrackerBodySchema, createTrackerBodyShape } from '@controllers/trackers/shared-schemas';
import { smartTrackingFieldsShape } from '@controllers/trackers/smart-tracking-fields.schema';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeTracker } from '@root/serializers/trackers.serializer';
import { createTracker } from '@services/trackers/create-tracker';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope, type ToolArgs } from './helpers';

const inputSchema = {
  name: createTrackerBodyShape.name.describe('Tracker name, 1-200 characters'),
  status: z
    .enum([TRACKER_STATUSES.active, TRACKER_STATUSES.archived, TRACKER_STATUSES.closed])
    .optional()
    .describe('Tracker status (default: active)'),
  rulesEnabled: createTrackerBodyShape.rulesEnabled.describe(
    "Auto-add the user's transactions in the date range matching any of categoryIds or tagIds. Needs at least one of them. Default: false",
  ),
  categoryIds: createTrackerBodyShape.categoryIds.describe('Rule categories; parent IDs include their children'),
  tagIds: createTrackerBodyShape.tagIds.describe('Rule tags'),
  rulesCleanup: createTrackerBodyShape.rulesCleanup.describe(
    'Remove rule-added transactions that stop matching the rules. Default: true',
  ),
  startDate: createTrackerBodyShape.startDate.describe('Tracker start, UTC datetime (e.g. "2026-10-01T00:00:00Z")'),
  endDate: createTrackerBodyShape.endDate.describe('Tracker end, UTC datetime; not before startDate'),
  limitAmount: z
    .number()
    .positive()
    .nullable()
    .optional()
    .describe("Spending limit as a decimal amount in the user's base currency (e.g. 500.00)"),
  limitKind: createTrackerBodyShape.limitKind.describe(
    'What limitAmount means: spending (a ceiling, default), income_target (income to reach) or income_cap (income to stay under)',
  ),
  logoDomain: createTrackerBodyShape.logoDomain.describe(
    'Brand domain to take the logo from (e.g. "airbnb.com"), no protocol or slashes. Not together with logoInitials or logoIcon',
  ),
  logoInitials: createTrackerBodyShape.logoInitials.describe(
    'One or two characters shown as a monogram. Not together with logoDomain',
  ),
  logoColor: createTrackerBodyShape.logoColor.describe(
    'Monogram or icon background as #rrggbb; needs logoInitials or logoIcon',
  ),
  logoIcon: createTrackerBodyShape.logoIcon.describe(
    'Icon key shown as the logo (e.g. "airplane-24-regular"). Not together with logoDomain or logoInitials',
  ),
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

/** The date-order and logo either-or rules span fields, so they run on the REST body schema. */
export function validateCreateTrackerArgs({ args }: { args: ToolArgs<typeof inputSchema> }) {
  const { status, ...fields } = args;
  return { status, ...createTrackerBodySchema.parse(fields) };
}

export function registerCreateTracker(server: McpServer) {
  server.registerTool(
    'create_tracker',
    {
      description:
        'Create a tracker with an optional spending limit, date range and logo. It does not create or change the period-based Budget plan. Set rulesEnabled with categoryIds and/or tagIds to auto-add matching transactions; link others with add_transactions_to_tracker. Set aiEnabled with aiDescription and startDate to turn on smart tracking; review its suggestions with list_tracker_suggestions. Returns the created tracker with its ID, status, rule categories and tags.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_tracker', clientId: extra.authInfo?.clientId });

      const { status, ...body } = validateCreateTrackerArgs({ args });

      const tracker = await createTracker({
        userId,
        name: body.name,
        status: status ?? TRACKER_STATUSES.active,
        rulesEnabled: body.rulesEnabled,
        rulesCleanup: body.rulesCleanup,
        categoryIds: body.categoryIds,
        tagIds: body.tagIds,
        startDate: body.startDate ? new Date(body.startDate) : undefined,
        endDate: body.endDate ? new Date(body.endDate) : undefined,
        limitAmount: body.limitAmount,
        limitKind: body.limitKind,
        logoDomain: body.logoDomain,
        logoInitials: body.logoInitials,
        logoColor: body.logoColor,
        logoIcon: body.logoIcon,
        aiEnabled: body.aiEnabled,
        aiDescription: body.aiDescription,
        aiPreWindowDays: body.aiPreWindowDays,
      });

      return jsonContent({ data: serializeTracker(tracker) });
    },
  );
}
