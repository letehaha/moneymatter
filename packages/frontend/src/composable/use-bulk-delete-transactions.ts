import { bulkDeleteTransactions } from '@/api/transactions';
import { VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { useNotificationCenter } from '@/components/notification-center';
import { useNotifyTrashed } from '@/composable/use-notify-trashed';
import { i18n } from '@/i18n';
import { ApiErrorResponseError } from '@/js/errors';
import type { BulkDeleteTransactionsBody } from '@bt/shared/types';
import { useMutation, useQueryClient } from '@tanstack/vue-query';

export function useBulkDeleteTransactions({ onSuccess }: { onSuccess?: () => void } = {}) {
  const queryClient = useQueryClient();
  const { addErrorNotification } = useNotificationCenter();
  const notifyTrashed = useNotifyTrashed();

  return useMutation({
    mutationFn: async (target: BulkDeleteTransactionsBody) => {
      return bulkDeleteTransactions(target);
    },
    onSuccess: (result) => {
      // Deletions move account balances, so refresh everything tx-derived.
      queryClient.invalidateQueries({
        queryKey: [VUE_QUERY_GLOBAL_PREFIXES.transactionChange],
      });

      const { t } = i18n.global;
      const skippedCount = result.skippedIds.length;
      if (result.deletedCount === 0 && skippedCount > 0) {
        addErrorNotification(t('transactions.bulkDelete.noneDeletedMessage', { count: skippedCount }, skippedCount));
        return;
      }

      const message = t('transactions.bulkDelete.successMessage', { count: result.deletedCount }, result.deletedCount);
      notifyTrashed({
        text: skippedCount
          ? `${message} ${t('transactions.bulkDelete.skippedMessage', { count: skippedCount }, skippedCount)}`
          : message,
        transactionIds: result.deletedIds,
      });

      onSuccess?.();
    },
    onError: (error) => {
      if (error instanceof ApiErrorResponseError) {
        addErrorNotification(error.data.message ?? 'Unknown error');
      } else {
        // eslint-disable-next-line no-console
        console.error(error);
        addErrorNotification(i18n.global.t('transactions.bulkDelete.unexpectedError'));
      }
    },
  });
}
