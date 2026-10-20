import { TRACKER_AI_DESCRIPTION_MAX_LENGTH, TRACKER_AI_PRE_WINDOW_DAYS } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { editTrackerBodySchema, editTrackerBodyShape } from '@controllers/trackers/shared-schemas';
import { smartTrackingFieldsShape } from '@controllers/trackers/smart-tracking-fields.schema';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeTracker } from '@root/serializers/trackers.serializer';
import { editTracker } from '@services/trackers/edit-tracker';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  trackerId: recordId().describe('ID of the tracker to update'),
  name: editTrackerBodyShape.name.describe('New tracker name, 1-200 characters'),
  startDate: editTrackerBodyShape.startDate.describe(
    'New start, UTC datetime (e.g. "2026-10-01T00:00:00Z"); null clears it',
  ),
  endDate: editTrackerBodyShape.endDate.describe('New end, UTC datetime, not before the start; null clears it'),
  limitAmount: z
    .number()
    .positive()
    .nullable()
    .optional()
    .describe(
      "New spending limit as a decimal amount in the user's base currency (e.g. 500.00). Pass null to remove the limit",
    ),
  rulesEnabled: editTrackerBodyShape.rulesEnabled.describe("Auto-add the user's transactions in the date range matching the rule categories or tags"),
  rulesCleanup: editTrackerBodyShape.rulesCleanup.describe('Remove rule-added transactions that stop matching the rules'),
  archivePromptDismissed: editTrackerBodyShape.archivePromptDismissed.describe('true hides the "archive this finished tracker" prompt in the app; false shows it again'),
  categoryIds: editTrackerBodyShape.categoryIds.describe('Replace the rule categories; parent IDs include their children'),
  tagIds: editTrackerBodyShape.tagIds.describe('Replace the rule tags'),
  logoDomain: editTrackerBodyShape.logoDomain.describe(
    'Brand domain to take the logo from (e.g. "airbnb.com"), or null to clear. Not together with logoInitials or logoIcon',
  ),
  logoInitials: editTrackerBodyShape.logoInitials.describe(
    'One or two characters shown as a monogram, or null to clear. Not together with logoDomain',
  ),
  logoColor: editTrackerBodyShape.logoColor.describe('Monogram or icon background as #rrggbb, or null for the default'),
  logoIcon: editTrackerBodyShape.logoIcon.describe(
    'Icon key shown as the logo (e.g. "airplane-24-regular"), or null to clear. Not together with logoDomain or logoInitials',
  ),
  aiEnabled: smartTrackingFieldsShape.aiEnabled.describe(
    'Turn smart tracking on or off. Owner only; enabling needs a description and a start date (already saved or passed here)',
  ),
  aiDescription: smartTrackingFieldsShape.aiDescription.describe(
    `Plain-language description of what belongs in the tracker (max ${TRACKER_AI_DESCRIPTION_MAX_LENGTH} chars). Owner only; null clears it`,
  ),
  aiPreWindowDays: smartTrackingFieldsShape.aiPreWindowDays.describe(
    `Days before startDate the AI also scans. One of ${TRACKER_AI_PRE_WINDOW_DAYS.join(', ')}. Owner only`,
  ),
};

export function registerUpdateTracker(server: McpServer) {
  server.registerTool(
    'update_tracker',
    {
      description:
        'Update the name, date range, spending limit, or rules (categories, tags, auto-add) of an existing tracker. Only passed fields change; limitAmount null removes the limit. With rules on, every update re-checks all transactions against them. Lines are managed with create_tracker_line, update_tracker_line and delete_tracker_line. Changing smart-tracking fields or dates rescans the tracker and fails while a scan is already queued or running. Returns the updated tracker record.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'update_tracker', clientId: extra.authInfo?.clientId });

      // The date-order and logo either-or rules span fields, so they run on the REST body schema.
      const { trackerId, ...fields } = args;
      const body = editTrackerBodySchema.parse(fields);

      const tracker = await editTracker({ id: trackerId, userId, ...body });

      return jsonContent({ data: tracker && serializeTracker(tracker) });
    },
  );
}
