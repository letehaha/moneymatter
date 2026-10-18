import { recordId } from '@common/lib/zod/custom-types';
import { notificationStatusSchema, notificationTypeSchema } from '@controllers/notifications/shared-schemas';
import { NotFoundError } from '@js/errors';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getNotificationById, getNotifications, getUnreadCount } from '@services/notifications';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  notificationId: recordId()
    .optional()
    .describe('Read this one notification, including a dismissed one. The other arguments are ignored'),
  status: notificationStatusSchema
    .optional()
    .describe('"unread", "read" or "dismissed". Without it the list holds unread and read notifications only'),
  type: notificationTypeSchema.optional().describe('Only notifications of this type, e.g. "budget_alert" or "system"'),
  limit: z.number().min(1).max(100).default(50).describe('Page size, 1 to 100. Default 50'),
  offset: z.number().min(0).default(0).describe('Offset into the list, 0 or more. Default 0'),
};

export function registerGetNotifications(server: McpServer) {
  server.registerTool(
    'get_notifications',
    {
      description:
        'List the in-app notifications of the user, newest first: budget alerts, tag and subscription reminders, bank sync messages and release notes. Without status the list leaves out dismissed notifications. Returns { data, total, unreadCount }; page with limit and offset. unreadCount counts every unread notification, whatever the filters. With notificationId returns that one notification instead. To mark them read use mark_notifications_read, to hide one use dismiss_notification.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_notifications', clientId: extra.authInfo?.clientId });

      if (args.notificationId) {
        const notification = await getNotificationById({ id: args.notificationId, userId });
        if (!notification) throw new NotFoundError({ message: 'Notification not found.' });

        return jsonContent({ data: notification });
      }

      const [result, unreadCount] = await Promise.all([
        getNotifications({
          userId,
          status: args.status,
          type: args.type,
          limit: args.limit,
          offset: args.offset,
        }),
        getUnreadCount({ userId }),
      ]);

      return jsonContent({ data: { data: result.data, total: result.total, unreadCount } });
    },
  );
}
