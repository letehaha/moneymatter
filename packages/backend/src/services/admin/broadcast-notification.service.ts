import {
  BroadcastSystemNotificationRequest,
  BroadcastSystemNotificationResponse,
  NOTIFICATION_TYPES,
  SystemNotificationPayload,
} from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import Notifications from '@models/notifications.model';
import Users from '@models/users.model';
import { withTransaction } from '@services/common/with-transaction';
import { getRecentlyActiveUserIds } from '@services/notifications/release-notifications';
import { QueryTypes } from 'sequelize';

import { connection } from '../../models';

const resolveTargetUserIds = async ({
  userIds,
  emails,
}: Pick<BroadcastSystemNotificationRequest, 'userIds' | 'emails'>): Promise<number[]> => {
  if (!userIds && !emails) return getRecentlyActiveUserIds();

  const byId = userIds ? await Users.findAll({ where: { id: userIds }, attributes: ['id'] }) : [];
  const byEmail = emails
    ? ((await connection.sequelize.query(
        `SELECT u.id FROM "Users" u JOIN ba_user b ON b.id = u."authUserId" WHERE LOWER(b.email) IN (:emails)`,
        { replacements: { emails: emails.map((e) => e.toLowerCase()) }, type: QueryTypes.SELECT },
      )) as { id: number }[])
    : [];

  return [...new Set([...byId, ...byEmail].map((u) => u.id))];
};

const broadcastSystemNotificationImpl = async ({
  actorId,
  title,
  message,
  url,
  icon,
  userIds,
  emails,
}: BroadcastSystemNotificationRequest & { actorId: number }): Promise<BroadcastSystemNotificationResponse> => {
  const targetUserIds = await resolveTargetUserIds({ userIds, emails });

  // Re-sending the same url skips users who already got it.
  const alreadyNotified = new Set(
    url
      ? (
          await Notifications.findAll({
            where: { type: NOTIFICATION_TYPES.system, userId: targetUserIds, payload: { url } },
            attributes: ['userId'],
          })
        ).map((n) => n.userId)
      : [],
  );
  const recipients = targetUserIds.filter((id) => !alreadyNotified.has(id));

  const payload: SystemNotificationPayload = { ...(url && { url }), ...(icon && { icon }) };
  await Notifications.bulkCreate(
    recipients.map((userId) => ({
      userId,
      type: NOTIFICATION_TYPES.system,
      title,
      message: message || null,
      payload,
    })),
  );

  logger.info('Admin broadcast a system notification', {
    actorId,
    title,
    url,
    requestedUserIds: userIds?.length,
    requestedEmails: emails?.length,
    created: recipients.length,
  });
  return { created: recipients.length };
};

export const broadcastSystemNotification = withTransaction(broadcastSystemNotificationImpl);
