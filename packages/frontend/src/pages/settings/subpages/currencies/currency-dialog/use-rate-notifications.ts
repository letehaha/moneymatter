import { useNotificationCenter } from '@/components/notification-center';
import { ApiErrorResponseError, extractApiErrorMessage, isHandledByApiClient } from '@/js/errors';
import { captureException } from '@/lib/sentry';
import type { RefBalanceRemeasureResult } from '@bt/shared/types';
import { useI18n } from 'vue-i18n';

/** Toasts for a rate write or removal. */
export const useRateNotifications = () => {
  const { t } = useI18n();
  const { addSuccessNotification, addWarningNotification, addErrorNotification } = useNotificationCenter();

  // `failed` counts accounts left on their old base value for lack of a market rate.
  const notifyRateSaved = ({ message, remeasure }: { message: string; remeasure: RefBalanceRemeasureResult }) => {
    addSuccessNotification(message);
    if (remeasure.failed > 0) {
      addWarningNotification(t('settings.currencies.exchangeRate.balancesNotRefreshed', { count: remeasure.failed }));
    }
  };

  const notifyRateFailed = ({ error, fallback, flow }: { error: unknown; fallback: string; flow: string }) => {
    if (isHandledByApiClient({ error })) return;
    if (!(error instanceof ApiErrorResponseError)) captureException({ error, context: { flow } });
    addErrorNotification(extractApiErrorMessage(error) || fallback);
  };

  return { notifyRateSaved, notifyRateFailed };
};
