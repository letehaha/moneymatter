import { deleteTrash, loadTrash, restoreTrash } from '@/api/transactions';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const/vue-query';
import { useNotificationCenter } from '@/components/notification-center';
import { usePayeeLookup } from '@/composable/data-queries/payees';
import { useInvalidatingMutation } from '@/composable/data-queries/use-invalidating-mutation';
import { TRASH_INVALIDATE_KEYS, TRASH_INVALIDATE_ON_SETTLE_KEYS } from '@/composable/use-notify-trashed';
import { formatUIAmount } from '@/js/helpers';
import { useCategoriesStore } from '@/stores';
import {
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  type RecordId,
  type TransactionModel,
  type TrashEntry,
} from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';

import { getOtherLeg, getPrimaryTransaction, getSignedAmount } from './helpers';

export const useTransactionsTrash = () =>
  useQuery({
    queryKey: VUE_QUERY_CACHE_KEYS.transactionsTrash,
    queryFn: loadTrash,
  });

export const useTrashActions = () => {
  const { t } = useI18n();
  const { addSuccessNotification, addWarningNotification } = useNotificationCenter();

  const restore = useInvalidatingMutation({
    mutationFn: restoreTrash,
    invalidateKeys: TRASH_INVALIDATE_KEYS,
    invalidateOnSettleKeys: TRASH_INVALIDATE_ON_SETTLE_KEYS,
    errorKey: 'transactions.trashPage.notifications.restoreError',
    onSuccess: ({ droppedRefundLinks }) => {
      if (droppedRefundLinks > 0) {
        addWarningNotification(
          t(
            'transactions.trashPage.notifications.restoredWithDroppedRefundLinks',
            { count: droppedRefundLinks },
            droppedRefundLinks,
          ),
        );
      } else {
        addSuccessNotification(t('transactions.trashPage.notifications.restored'));
      }
    },
  });
  const remove = useInvalidatingMutation({
    mutationFn: deleteTrash,
    invalidateKeys: TRASH_INVALIDATE_KEYS,
    invalidateOnSettleKeys: TRASH_INVALIDATE_ON_SETTLE_KEYS,
    successKey: 'transactions.trashPage.notifications.deleted',
    errorKey: 'transactions.trashPage.notifications.deleteError',
  });
  return { restore, remove };
};

export interface TrashEntryDisplay {
  title: string;
  categoryLabel: string;
  accountName: string;
  amountText: string;
  amountClass: string;
  isPlanned: boolean;
  time: TransactionModel['time'];
  otherLeg: { accountName: string; amountText: string } | null;
}

export const useTrashEntryDisplay = () => {
  const { t } = useI18n();
  const { categoriesMap } = storeToRefs(useCategoriesStore());
  const { nameById: payeeNameById } = usePayeeLookup();

  const accountNameOf = ({ entry, accountId }: { entry: TrashEntry; accountId: RecordId }) =>
    entry.accountNames[accountId] ?? t('transactions.trashPage.unknownAccount');

  return ({ entry }: { entry: TrashEntry }): TrashEntryDisplay => {
    const tx = getPrimaryTransaction({ entry });
    const other = getOtherLeg({ entry });
    const isTransfer = tx.transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer;
    const accountName = accountNameOf({ entry, accountId: tx.accountId });
    const amountText = formatUIAmount(getSignedAmount({ transaction: tx }), { currency: tx.currencyCode });
    const categoryName = categoriesMap.value[tx.categoryId]?.name ?? t('common.ui.other');

    let amountClass = 'text-app-expense-color';
    if (isTransfer) amountClass = 'text-app-transfer-color';
    else if (tx.transactionType === TRANSACTION_TYPES.income) amountClass = 'text-app-income-color';

    let title = (tx.payeeId && payeeNameById.value[tx.payeeId]) || tx.note || categoryName;
    if (other) {
      const [from, to] = tx.transactionType === TRANSACTION_TYPES.expense ? [tx, other] : [other, tx];
      title = t('transactions.trashPage.transferTitle', {
        from: accountNameOf({ entry, accountId: from.accountId }),
        to: accountNameOf({ entry, accountId: to.accountId }),
      });
    }

    return {
      title,
      categoryLabel: isTransfer ? t('transactions.trashPage.transferLabel') : categoryName,
      accountName,
      amountText,
      amountClass,
      isPlanned: tx.isPlanned,
      time: tx.time,
      otherLeg: other
        ? {
            accountName: accountNameOf({ entry, accountId: other.accountId }),
            amountText: formatUIAmount(getSignedAmount({ transaction: other }), { currency: other.currencyCode }),
          }
        : null,
    };
  };
};
