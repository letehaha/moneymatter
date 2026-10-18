import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { dismissNotification } from '@services/notifications';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  notificationId: recordId().describe('Notification to dismiss (from get_notifications)'),
};

export function registerDismissNotification(server: McpServer) {
  server.registerTool(
    'dismiss_notification',
    {
      description:
        'Dismiss a notification: it leaves the default list of get_notifications and stops counting as unread. Returns { success }; success is false when the id is unknown. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'dismiss_notification', clientId: extra.authInfo?.clientId });

      const success = await dismissNotification({ id: args.notificationId, userId });
      return jsonContent({ data: { success } });
    },
  );
}
