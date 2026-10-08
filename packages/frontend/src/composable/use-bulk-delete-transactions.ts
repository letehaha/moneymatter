import { bulkDeleteTransactions } from '@/api/transactions';
import { VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { useNotificationCenter } from '@/components/notification-center';
import { i18n } from '@/i18n';
import { ApiErrorResponseError } from '@/js/errors';
import type { endpointsTypes } from '@bt/shared/types';
import { useMutation, useQueryClient } from '@tanstack/vue-query';

export function useBulkDeleteTransactions({ onSuccess }: { onSuccess?: () => void } = {}) {
  const queryClient = useQueryClient();
  const { addErrorNotification, addSuccessNotification } = useNotificationCenter();

  return useMutation({
    mutationFn: async (target: endpointsTypes.BulkDeleteTransactionsBody) => {
      return bulkDeleteTransactions(target);
    },
    onSuccess: (result) => {
      // Deletions move account balances, so refresh everything tx-derived.
      queryClient.invalidateQueries({
        queryKey: [VUE_QUERY_GLOBAL_PREFIXES.transactionChange],
      });

      addSuccessNotification(i18n.global.t('transactions.bulkDelete.successMessage', { count: result.deletedCount }));

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
