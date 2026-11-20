import { restoreTrash } from '@/api/transactions';
import { VUE_QUERY_CACHE_KEYS, VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const/vue-query';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useInvalidatingMutation } from '@/composable/data-queries/use-invalidating-mutation';
import { TRANSACTION_TRASH_ACTION_MAX, type RecordId } from '@bt/shared/types';
import { useI18n } from 'vue-i18n';

export const TRASH_INVALIDATE_KEYS = [[VUE_QUERY_GLOBAL_PREFIXES.transactionChange]];
export const TRASH_INVALIDATE_ON_SETTLE_KEYS = [VUE_QUERY_CACHE_KEYS.transactionsTrash];

const UNDO_VISIBILITY_MS = 8000;

/** Raises the "moved to Trash" toast with an Undo that restores the given rows. */
export const useNotifyTrashed = () => {
  const { t } = useI18n();
  const { addNotification } = useNotificationCenter();
  const undo = useInvalidatingMutation({
    mutationFn: restoreTrash,
    invalidateKeys: TRASH_INVALIDATE_KEYS,
    invalidateOnSettleKeys: TRASH_INVALIDATE_ON_SETTLE_KEYS,
    successKey: 'common.transactions.delete.undoSuccess',
    errorKey: 'common.transactions.delete.undoError',
  });

  return ({ text, transactionIds }: { text: string; transactionIds: string[] }) =>
    addNotification({
      id: `trashed:${transactionIds.join(',')}`,
      text,
      type: NotificationType.success,
      visibilityTime: UNDO_VISIBILITY_MS,
      action:
        transactionIds.length && transactionIds.length <= TRANSACTION_TRASH_ACTION_MAX
          ? {
              label: t('common.actions.undo'),
              icon: 'undo',
              onClick: () => undo.mutate({ transactionIds: transactionIds as RecordId[] }),
            }
          : undefined,
    });
};
