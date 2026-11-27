import { NOTIFICATION_TYPES } from '@bt/shared/types';
import { t } from '@i18n/index';
import { logger } from '@js/utils/logger';
import * as notificationsService from '@services/notifications';
import { getUserSettings } from '@services/user-settings/get-user-settings';

/**
 * A merge silently rewrites a row the user typed in, so every sync run that
 * confirmed plans must leave a user-visible trace.
 */
export const notifyPlannedConfirmations = async ({
  userId,
  accountId,
  mergedCount,
}: {
  userId: number;
  accountId: string;
  mergedCount: number;
}): Promise<void> => {
  if (mergedCount <= 0) return;

  try {
    const { locale } = await getUserSettings({ userId });
    await notificationsService.createNotification({
      userId,
      type: NOTIFICATION_TYPES.plannedConfirmed,
      title: t({
        key: 'transactions.plannedConfirmedNotification.title',
        variables: { count: mergedCount },
        locale,
      }),
      payload: { accountId, mergedCount },
    });
  } catch (error) {
    logger.error({ message: 'Failed to create planned-confirmation notification', error: error as Error });
  }
};
