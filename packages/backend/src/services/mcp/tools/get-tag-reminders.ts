import { recordId } from '@common/lib/zod/custom-types';
import { serializeTagReminder, serializeTagReminders } from '@root/serializers';
import { getAllReminders, getReminderById, getRemindersForTag } from '@services/tag-reminders';

import { defineTool } from '../define-tool';

export const getTagRemindersTool = defineTool({
  name: 'get_tag_reminders',
  toolset: 'automations',
  access: 'read',
  description:
    "List tag reminders: rules that notify the user about the transactions of a tag, either when the tag total in a period passes an amount (amount_threshold) or when the tag has no transaction in the period (existence_check). frequency is daily, weekly, monthly, quarterly or yearly, and null for a real-time reminder that fires when a tagged transaction is saved; dayOfMonth sets the day for the monthly, quarterly and yearly ones. settings.amountThreshold is a decimal in the base currency. With no arguments returns every reminder of the user, oldest first; with tagId only that tag's reminders; with tagId and reminderId one reminder.",
  input: {
    tagId: recordId().optional().describe('Tag id (from get_tags). Lists only the reminders of this tag'),
    reminderId: recordId().optional().describe('Reminder id. Reads that one reminder; needs tagId'),
  },
  run: async ({ userId, args }) => {
    if (args.reminderId) {
      if (!args.tagId) {
        throw new Error('reminderId needs tagId: pass the tag the reminder belongs to.');
      }
      const reminder = await getReminderById({ id: args.reminderId, userId, tagId: args.tagId });
      return serializeTagReminder(reminder);
    }

    const reminders = args.tagId
      ? await getRemindersForTag({ userId, tagId: args.tagId })
      : await getAllReminders({ userId });

    return serializeTagReminders(reminders);
  },
});
