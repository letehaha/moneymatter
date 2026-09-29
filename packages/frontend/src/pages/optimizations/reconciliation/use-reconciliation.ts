import {
  checkStuckPending,
  keepAsBooked,
  loadReconciliationHistory,
  loadStuckPending,
  reconciliationMerge,
  reconciliationRemove,
  reconciliationRestore,
} from '@/api/transactions';
import { VUE_QUERY_CACHE_KEYS, VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const/vue-query';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useInvalidatingMutation } from '@/composable/data-queries/use-invalidating-mutation';
import type { RecordId } from '@bt/shared/types';
import type { CheckStuckPendingResponse } from '@bt/shared/types/endpoints';
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';

export const useStuckPending = () =>
  useQuery({
    queryKey: VUE_QUERY_CACHE_KEYS.reconciliationStuckPending,
    queryFn: loadStuckPending,
  });

export const useReconciliationHistory = () =>
  useQuery({
    queryKey: VUE_QUERY_CACHE_KEYS.reconciliationHistory,
    queryFn: loadReconciliationHistory,
  });

const INVALIDATE_KEYS = [[VUE_QUERY_GLOBAL_PREFIXES.transactionChange]];
const ERROR_KEY = 'optimizations.reconciliation.notifications.unexpectedError';
const BANK_CHECK_KEY = 'optimizations.reconciliation.notifications.bankCheck';

type BankCheckTotals = CheckStuckPendingResponse & { failedCount: number };

// Sequential: accounts on the same bank connection would otherwise sync concurrently.
const checkAccountsWithBank = async ({ accountIds }: { accountIds: RecordId[] }): Promise<BankCheckTotals> => {
  const totals: BankCheckTotals = { bookedCount: 0, pendingCount: 0, failedCount: 0 };
  let firstError: unknown;
  for (const accountId of accountIds) {
    try {
      const { bookedCount, pendingCount } = await checkStuckPending({ accountId });
      totals.bookedCount += bookedCount;
      totals.pendingCount += pendingCount;
    } catch (error) {
      firstError ??= error;
      totals.failedCount += 1;
    }
  }
  if (totals.failedCount && totals.failedCount === accountIds.length) throw firstError;
  return totals;
};

export const useReconciliationActions = () => {
  const { t } = useI18n();
  const { addNotification } = useNotificationCenter();

  const bankCheckText = ({ bookedCount, pendingCount, failedCount }: BankCheckTotals) => {
    const failedText = failedCount ? t(`${BANK_CHECK_KEY}.someFailed`, { count: failedCount }, failedCount) : '';
    if (!pendingCount) {
      return {
        text: bookedCount
          ? t(`${BANK_CHECK_KEY}.allBooked`, { count: bookedCount }, bookedCount)
          : t('optimizations.reconciliation.notifications.checkedWithBank'),
        description: failedText || undefined,
      };
    }
    return {
      text: bookedCount
        ? t(`${BANK_CHECK_KEY}.someBooked`, { count: bookedCount }, bookedCount)
        : t(`${BANK_CHECK_KEY}.noneBooked`),
      description: [t(`${BANK_CHECK_KEY}.stillPending`, { count: pendingCount }, pendingCount), failedText]
        .filter(Boolean)
        .join(' '),
    };
  };

  const remove = useInvalidatingMutation({
    invalidateKeys: INVALIDATE_KEYS,
    errorKey: ERROR_KEY,
    mutationFn: reconciliationRemove,
    successMessage: ({ removedIds }) =>
      t('optimizations.reconciliation.notifications.removed', { count: removedIds.length }, removedIds.length),
  });

  const merge = useInvalidatingMutation({
    invalidateKeys: INVALIDATE_KEYS,
    errorKey: ERROR_KEY,
    mutationFn: reconciliationMerge,
    successMessage: ({ removedIds }) =>
      t('optimizations.reconciliation.notifications.merged', { count: removedIds.length }, removedIds.length),
  });

  const restore = useInvalidatingMutation({
    invalidateKeys: INVALIDATE_KEYS,
    errorKey: ERROR_KEY,
    mutationFn: reconciliationRestore,
    successMessage: ({ restoredIds }) =>
      t('optimizations.reconciliation.notifications.restored', { count: restoredIds.length }, restoredIds.length),
  });

  const keepBooked = useInvalidatingMutation({
    invalidateKeys: INVALIDATE_KEYS,
    errorKey: ERROR_KEY,
    mutationFn: keepAsBooked,
    successKey: 'optimizations.reconciliation.notifications.keptAsBooked',
  });

  const checkWithBank = useInvalidatingMutation({
    invalidateKeys: INVALIDATE_KEYS,
    errorKey: ERROR_KEY,
    mutationFn: checkAccountsWithBank,
    persistentErrorId: 'reconciliation-bank-check',
    onSuccess: (result) =>
      addNotification({
        id: 'reconciliation-bank-check',
        type: result.failedCount ? NotificationType.warning : NotificationType.success,
        persistent: true,
        ...bankCheckText(result),
      }),
  });

  return { remove, merge, restore, keepBooked, checkWithBank };
};
