import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeTagReminder, serializeTagReminders } from '@root/serializers';
import { getAllReminders, getReminderById, getRemindersForTag } from '@services/tag-reminders';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  tagId: recordId().optional().describe('Tag id (from get_tags). Lists only the reminders of this tag'),
  reminderId: recordId().optional().describe('Reminder id. Reads that one reminder; needs tagId'),
};

export function registerGetTagReminders(server: McpServer) {
  server.registerTool(
    'get_tag_reminders',
    {
      description:
        "List tag reminders: rules that notify the user about the transactions of a tag, either when the tag total in a period passes an amount (amount_threshold) or when the tag has no transaction in the period (existence_check). frequency is daily, weekly, monthly, quarterly or yearly, and null for a real-time reminder that fires when a tagged transaction is saved; dayOfMonth sets the day for the monthly, quarterly and yearly ones. settings.amountThreshold is a decimal in the base currency. With no arguments returns every reminder of the user, oldest first; with tagId only that tag's reminders; with tagId and reminderId one reminder.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_tag_reminders', clientId: extra.authInfo?.clientId });

      if (args.reminderId) {
        if (!args.tagId) {
          throw new Error('reminderId needs tagId: pass the tag the reminder belongs to.');
        }
        const reminder = await getReminderById({ id: args.reminderId, userId, tagId: args.tagId });
        return jsonContent({ data: serializeTagReminder(reminder) });
      }

      const reminders = args.tagId
        ? await getRemindersForTag({ userId, tagId: args.tagId })
        : await getAllReminders({ userId });

      return jsonContent({ data: serializeTagReminders(reminders) });
    },
  );
}
