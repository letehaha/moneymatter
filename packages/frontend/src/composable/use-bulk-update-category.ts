import { bulkUpdateTransactions } from '@/api/transactions';
import { VUE_QUERY_CACHE_KEYS, VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { useNotificationCenter } from '@/components/notification-center';
import { i18n } from '@/i18n';
import { ApiErrorResponseError } from '@/js/errors';
import type { endpointsTypes } from '@bt/shared/types';
import { useMutation, useQueryClient } from '@tanstack/vue-query';

export function useBulkUpdateCategory({ onSuccess }: { onSuccess?: () => void } = {}) {
  const queryClient = useQueryClient();
  const { addErrorNotification, addSuccessNotification } = useNotificationCenter();

  return useMutation({
    mutationFn: async (params: endpointsTypes.BulkUpdateTransactionsBody) => {
      return bulkUpdateTransactions(params);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: [VUE_QUERY_GLOBAL_PREFIXES.transactionChange],
      });
      // Payee assignments change every dropdown's stats (txCount, lastSeenAt,
      // topCategoryId), so refresh the Payee caches on every bulk update —
      // cheap and keeps autocomplete ordering accurate.
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.payeesList });
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.payeesLookup });
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.payeesByAccount });
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.payeeById });

      addSuccessNotification(i18n.global.t('transactions.bulkEdit.successMessage', { count: result.updatedCount }));

      onSuccess?.();
    },
    onError: (error) => {
      if (error instanceof ApiErrorResponseError) {
        addErrorNotification(error.data.message ?? 'Unknown error');
      } else {
        // eslint-disable-next-line no-console
        console.error(error);
        addErrorNotification(i18n.global.t('transactions.bulkEdit.unexpectedError'));
      }
    },
  });
}
