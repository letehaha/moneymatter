import {
  NOTIFICATION_STATUSES,
  NOTIFICATION_TYPES,
  type RecordId,
  type StuckPendingNotificationPayload,
} from '@bt/shared/types';
import { t } from '@i18n/index';
import { logger } from '@js/utils/logger';
import Notifications from '@models/notifications.model';
import * as notificationsService from '@services/notifications';

import { findStuckPending } from './stuck-pending';

const alreadyNotified = async ({ userId, transactionIds }: { userId: number; transactionIds: RecordId[] }) => {
  const where = { userId, type: NOTIFICATION_TYPES.stuckPending };
  if (await Notifications.count({ where: { ...where, status: NOTIFICATION_STATUSES.unread } })) return true;

  const latest = await Notifications.findOne({ where, order: [['createdAt', 'DESC']] });
  const payloadIds = (latest?.payload as { transactionIds?: unknown } | undefined)?.transactionIds;
  const known = new Set<unknown>(Array.isArray(payloadIds) ? payloadIds : []);
  return transactionIds.every((id) => known.has(id));
};

/** Never triggers a bank sync: Enable Banking caps daily syncs, and the stuck tab offers one on demand. */
export const notifyStuckPending = async () => {
  const rows = await findStuckPending({ access: 'unscoped-internal', attributes: ['id', 'userId'] });
  const byUser = Map.groupBy(rows, (row) => row.userId);
  const result = { usersChecked: byUser.size, notified: 0, failed: 0, errors: [] as string[] };

  for (const [userId, userRows] of byUser) {
    const transactionIds = userRows.map((row) => row.id);
    try {
      if (await alreadyNotified({ userId, transactionIds })) continue;

      const count = transactionIds.length;
      await notificationsService.createNotification({
        userId,
        type: NOTIFICATION_TYPES.stuckPending,
        title: t({ key: 'transactions.reconciliation.stuckPendingNotification.title' }),
        message: t({ key: 'transactions.reconciliation.stuckPendingNotification.message', variables: { count } }),
        payload: { transactionIds } satisfies StuckPendingNotificationPayload,
      });
      result.notified += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push(`user ${userId}: ${(error as Error).message}`);
      logger.error({ message: `Stuck pending notification failed for user ${userId}`, error: error as Error });
    }
  }

  return result;
};
