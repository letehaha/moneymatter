import { recordId } from '@common/lib/zod/custom-types';
import {
  reminderAmountThresholdSchema,
  reminderDayOfMonthSchema,
  reminderFrequencySchema,
  reminderTypeSchema,
} from '@controllers/tag-reminders/shared-schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deserializeUpdateTagReminder, serializeTagReminder } from '@root/serializers';
import { updateReminder } from '@services/tag-reminders';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  tagId: recordId().describe('Tag the reminder belongs to'),
  reminderId: recordId().describe('Reminder id (from get_tag_reminders)'),
  type: reminderTypeSchema.optional().describe('"amount_threshold" or "existence_check"'),
  frequency: reminderFrequencySchema
    .nullable()
    .optional()
    .describe('daily, weekly, monthly, quarterly or yearly. null makes it a real-time reminder'),
  dayOfMonth: reminderDayOfMonthSchema.nullable().optional().describe('Day of the month, 1 to 31. null clears it'),
  amountThreshold: reminderAmountThresholdSchema
    .optional()
    .describe('New threshold, 0.01 or more, a decimal in the base currency'),
  isEnabled: z.boolean().optional().describe('false pauses the reminder, true resumes it'),
};

export function registerUpdateTagReminder(server: McpServer) {
  server.registerTool(
    'update_tag_reminder',
    {
      description:
        'Update a tag reminder. Send tagId, reminderId and only the fields to change: an omitted field stays as it is, and null clears frequency (making it real-time) or dayOfMonth. An amount_threshold reminder must keep a threshold, and a change that would duplicate another reminder of the tag is refused as already existing. Returns the reminder. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'update_tag_reminder', clientId: extra.authInfo?.clientId });

      const deserialized = deserializeUpdateTagReminder({
        type: args.type,
        frequency: args.frequency,
        dayOfMonth: args.dayOfMonth,
        settings: args.amountThreshold === undefined ? undefined : { amountThreshold: args.amountThreshold },
        isEnabled: args.isEnabled,
      });
      const reminder = await updateReminder({
        id: args.reminderId,
        userId,
        tagId: args.tagId,
        type: deserialized.type,
        frequency: deserialized.frequency,
        dayOfMonth: deserialized.dayOfMonth,
        settings: deserialized.settings,
        isEnabled: deserialized.isEnabled,
      });

      return jsonContent({ data: serializeTagReminder(reminder) });
    },
  );
}
