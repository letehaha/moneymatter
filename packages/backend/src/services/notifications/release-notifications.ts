import { ChangelogNotificationPayload, NOTIFICATION_TYPES } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import Notifications from '@models/notifications.model';
import { enqueueWebPushAfterCommit } from '@services/web-push/enqueue-web-push';
import { QueryTypes } from 'sequelize';

import { connection } from '../../models';
import { withTransaction } from '../common/with-transaction';

const RECENT_ACTIVITY_DAYS = 30;

interface CreateReleaseNotificationParams {
  version: string;
  releaseName: string;
  releaseUrl: string;
  releaseDate: string;
}

/**
 * Gets user IDs of users who have been active in the last N days.
 * Uses the ba_session table from better-auth to determine activity.
 */
async function getRecentlyActiveUserIds(): Promise<number[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RECENT_ACTIVITY_DAYS);

  // Query ba_session to get unique authUserIds, then join with Users to get app user IDs
  const results = (await connection.sequelize.query(
    `
    SELECT DISTINCT u.id
    FROM "Users" u
    INNER JOIN ba_session s ON u."authUserId" = s."userId"
    WHERE s."updatedAt" >= :cutoffDate
  `,
    {
      replacements: { cutoffDate },
      type: QueryTypes.SELECT,
    },
  )) as { id: number }[];

  return results.map((r) => r.id);
}

/**
 * Checks if a release notification for this version already exists for any user.
 * Used for deduplication when webhook fires multiple times.
 */
async function releaseNotificationExists({ version }: { version: string }): Promise<boolean> {
  const existing = await Notifications.findOne({
    where: {
      type: NOTIFICATION_TYPES.changelog,
      payload: {
        version,
      },
    },
  });

  return existing !== null;
}

/**
 * Creates release notifications for all recently active users.
 * Skips if notification for this version already exists (deduplication).
 */
export const createReleaseNotifications = withTransaction(
  async ({ version, releaseName, releaseUrl, releaseDate }: CreateReleaseNotificationParams): Promise<number> => {
    // Check for duplicate
    if (await releaseNotificationExists({ version })) {
      logger.info(`Release notification for ${version} already exists, skipping`);
      return 0;
    }

    // Get recently active users
    const userIds = await getRecentlyActiveUserIds();

    if (userIds.length === 0) {
      logger.info('No recently active users found for release notification');
      return 0;
    }

    logger.info(`Creating release notifications for ${userIds.length} users`);

    const payload: ChangelogNotificationPayload = {
      version,
      releaseName,
      releaseUrl,
      releaseDate,
    };

    // Bulk create notifications for all users
    // Frontend builds display title from payload with i18n, this is just for DB
    const notifications = userIds.map((userId) => ({
      userId,
      type: NOTIFICATION_TYPES.changelog,
      title: `New version ${version}`,
      message: null,
      payload,
    }));

    const created = await Notifications.bulkCreate(notifications);
    enqueueWebPushAfterCommit({ notificationIds: created.map(({ id }) => id) });

    logger.info(`Created ${notifications.length} release notifications for version ${version}`);

    return notifications.length;
  },
);
