import { deleteImportBatch } from '@/api/import-export';
import { VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { useNotificationCenter } from '@/components/notification-center';
import { useImportBatchDeleteJobStatus } from '@/composable/use-import-batch-delete-job-status';
import { i18n } from '@/i18n';
import { ApiErrorResponseError } from '@/js/errors';
import { useMutation, useQueryClient } from '@tanstack/vue-query';

export function useDeleteImportBatch({ onSuccess }: { onSuccess?: () => void } = {}) {
  const queryClient = useQueryClient();
  const { addErrorNotification, addSuccessNotification } = useNotificationCenter();

  return useMutation({
    mutationFn: async ({ batchId, deleteLinkedTransfers }: { batchId: string; deleteLinkedTransfers?: boolean }) =>
      deleteImportBatch({ batchId, deleteLinkedTransfers }),
    onSuccess: (result) => {
      if ('jobId' in result) {
        // Too large to delete inline: the server runs it as a job holding the app-wide
        // write-lock. The watchdog blocks the UI and reloads once it lands.
        useImportBatchDeleteJobStatus().start({ initialStatus: { state: 'queued', jobId: result.jobId } });
        onSuccess?.();
        return;
      }

      // Deletions move account balances, so refresh everything tx-derived
      // (this also covers the batch-history list itself).
      queryClient.invalidateQueries({
        queryKey: [VUE_QUERY_GLOBAL_PREFIXES.transactionChange],
      });

      addSuccessNotification(
        result.deletedCount === 0
          ? i18n.global.t('pages.importExport.importHistory.deleteSuccessNoTransactions')
          : i18n.global.t('pages.importExport.importHistory.deleteSuccessMessage', { count: result.deletedCount }),
      );

      onSuccess?.();
    },
    onError: (error) => {
      if (error instanceof ApiErrorResponseError) {
        addErrorNotification(error.data.message ?? 'Unknown error');
      } else {
        // eslint-disable-next-line no-console
        console.error(error);
        addErrorNotification(i18n.global.t('pages.importExport.importHistory.deleteUnexpectedError'));
      }
    },
  });
}
