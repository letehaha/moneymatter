import { deleteTransaction } from '@/api';
import { VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { useNotificationCenter } from '@/components/notification-center';
import { useNotifyTrashed } from '@/composable/use-notify-trashed';
import { i18n } from '@/i18n';
import { ApiErrorResponseError } from '@/js/errors';
import { useMutation, useQueryClient } from '@tanstack/vue-query';

interface DeleteTransactionParams {
  transactionId: string;
}

export function useDeleteTransaction({ onSuccess }: { onSuccess: () => void }) {
  const queryClient = useQueryClient();
  const { addErrorNotification } = useNotificationCenter();
  const notifyTrashed = useNotifyTrashed();

  return useMutation({
    mutationFn: async (params: DeleteTransactionParams) => {
      return deleteTransaction(params.transactionId);
    },
    onSuccess: (_data, { transactionId }) => {
      queryClient.invalidateQueries({ queryKey: [VUE_QUERY_GLOBAL_PREFIXES.transactionChange] });
      notifyTrashed({ text: i18n.global.t('common.transactions.delete.success'), transactionIds: [transactionId] });
      onSuccess();
    },
    onError: (error) => {
      if (error instanceof ApiErrorResponseError) {
        addErrorNotification(error.data.message ?? error.message);
      } else {
        // eslint-disable-next-line no-console
        console.error(error);
        addErrorNotification(i18n.global.t('common.transactions.delete.error'));
      }
    },
  });
}
