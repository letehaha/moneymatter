import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deleteReminder } from '@services/tag-reminders';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  tagId: recordId().describe('Tag the reminder belongs to'),
  reminderId: recordId().describe('Reminder id (from get_tag_reminders)'),
};

export function registerDeleteTagReminder(server: McpServer) {
  server.registerTool(
    'delete_tag_reminder',
    {
      description:
        'Permanently delete a tag reminder. To stop one temporarily use update_tag_reminder with isEnabled false. Only call when the user explicitly confirms deletion. Requires finance:delete scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_tag_reminder', clientId: extra.authInfo?.clientId });

      await deleteReminder({ id: args.reminderId, userId, tagId: args.tagId });
      return jsonContent({ data: { deleted: true, reminderId: args.reminderId } });
    },
  );
}
