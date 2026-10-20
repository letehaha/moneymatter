import { TRACKER_AI_DESCRIPTION_MAX_LENGTH, TRACKER_AI_PRE_WINDOW_DAYS } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { smartTrackingFieldsShape } from '@controllers/trackers/smart-tracking-fields.schema';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeTracker } from '@root/serializers/trackers.serializer';
import { editTracker } from '@services/trackers/edit-tracker';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  trackerId: recordId().describe('ID of the tracker to update'),
  name: z.string().optional().describe('New tracker name'),
  startDate: z.string().nullable().optional().describe('New start date (ISO 8601); null clears it'),
  endDate: z.string().nullable().optional().describe('New end date (ISO 8601); null clears it'),
  limitAmount: z
    .number()
    .positive()
    .nullable()
    .optional()
    .describe(
      "New spending limit as a decimal amount in the user's base currency (e.g. 500.00). Pass null to remove the limit",
    ),
  autoInclude: z.boolean().optional().describe('Whether to auto-include transactions in the date range'),
  archivePromptDismissed: z
    .boolean()
    .optional()
    .describe('true hides the "archive this finished tracker" prompt in the app; false shows it again'),
  categoryIds: z
    .array(recordId())
    .optional()
    .describe('Replace the linked category IDs (only applies to category-type trackers)'),
  aiEnabled: smartTrackingFieldsShape.aiEnabled.describe(
    'Turn smart tracking on or off. Owner only; manual trackers only; enabling needs a description and a start date (already saved or passed here)',
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
        'Update the name, date range, spending limit, or linked categories of an existing tracker. Only passed fields change; limitAmount null removes the limit. Lines are managed with create_tracker_line, update_tracker_line and delete_tracker_line. Changing smart-tracking fields or dates rescans the tracker and fails while a scan is already queued or running. Returns the updated tracker record.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'update_tracker', clientId: extra.authInfo?.clientId });

      const tracker = await editTracker({
        id: args.trackerId,
        userId,
        name: args.name,
        startDate: args.startDate,
        endDate: args.endDate,
        limitAmount: args.limitAmount == null ? args.limitAmount : Money.fromDecimal(args.limitAmount),
        autoInclude: args.autoInclude,
        archivePromptDismissed: args.archivePromptDismissed,
        categoryIds: args.categoryIds,
        aiEnabled: args.aiEnabled,
        aiDescription: args.aiDescription,
        aiPreWindowDays: args.aiPreWindowDays,
      });

      return jsonContent({ data: tracker && serializeTracker(tracker) });
    },
  );
}
