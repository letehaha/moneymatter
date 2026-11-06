import { recordId } from '@common/lib/zod/custom-types';
import { deleteReminder } from '@services/tag-reminders';

import { defineTool } from '../define-tool';

export const deleteTagReminderTool = defineTool({
  name: 'delete_tag_reminder',
  toolset: 'automations',
  access: 'delete',
  description:
    'Permanently delete a tag reminder. To stop one temporarily use update_tag_reminder with isEnabled false. Only call when the user explicitly confirms deletion.',
  input: {
    tagId: recordId().describe('Tag the reminder belongs to'),
    reminderId: recordId().describe('Reminder id (from get_tag_reminders)'),
  },
  run: async ({ userId, args }) => {
    await deleteReminder({ id: args.reminderId, userId, tagId: args.tagId });
    return { deleted: true, reminderId: args.reminderId };
  },
});
