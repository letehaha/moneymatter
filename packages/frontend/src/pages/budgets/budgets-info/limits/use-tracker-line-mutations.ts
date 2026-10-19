import { createTrackerLine, deleteTrackerLine, updateTrackerLine } from '@/api/budgets';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useNotificationCenter } from '@/components/notification-center';
import type { BudgetModel, TrackerLinePayload } from '@bt/shared/types';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { omit } from 'lodash-es';
import { type MaybeRefOrGetter, toValue } from 'vue';
import { useI18n } from 'vue-i18n';

import { reportTrackerError, useInvalidateTracker } from '../../components/use-tracker-actions';

export const useTrackerLineMutations = ({ budgetId }: { budgetId: MaybeRefOrGetter<string> }) => {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const { addSuccessNotification } = useNotificationCenter();
  const invalidateTracker = useInvalidateTracker();

  const budgetKey = () => [...VUE_QUERY_CACHE_KEYS.budgetsListItem, toValue(budgetId)];
  const invalidate = () => invalidateTracker({ budgetId: toValue(budgetId) });

  const onError = ({ error, fallbackKey }: { error: unknown; fallbackKey: string }) =>
    reportTrackerError({ error, fallbackKey, context: { source: 'trackerLines', budgetId: toValue(budgetId) } });

  const createLine = useMutation({
    mutationFn: ({ payload }: { payload: TrackerLinePayload }) =>
      createTrackerLine({ budgetId: toValue(budgetId), payload }),
    onSuccess: () => addSuccessNotification(t('budgets.lines.notifications.created')),
    onError: (error) => onError({ error, fallbackKey: 'budgets.lines.notifications.createError' }),
    onSettled: invalidate,
  });

  const updateLine = useMutation({
    mutationFn: ({ lineId, payload }: { lineId: string; payload: Partial<TrackerLinePayload> }) =>
      updateTrackerLine({ budgetId: toValue(budgetId), lineId, payload }),
    onMutate: async ({ lineId, payload }) => {
      await queryClient.cancelQueries({ queryKey: budgetKey() });
      const previous = queryClient.getQueryData<BudgetModel>(budgetKey());
      queryClient.setQueryData<BudgetModel>(budgetKey(), (old) =>
        old
          ? {
              ...old,
              lines: old.lines.map((line) =>
                line.id === lineId ? { ...line, ...omit(payload, 'categoryIds') } : line,
              ),
            }
          : old,
      );
      return { previous };
    },
    onSuccess: () => addSuccessNotification(t('budgets.lines.notifications.updated')),
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(budgetKey(), context.previous);
      onError({ error, fallbackKey: 'budgets.lines.notifications.updateError' });
    },
    onSettled: invalidate,
  });

  const deleteLine = useMutation({
    mutationFn: ({ lineId }: { lineId: string }) => deleteTrackerLine({ budgetId: toValue(budgetId), lineId }),
    onSuccess: () => addSuccessNotification(t('budgets.lines.notifications.deleted')),
    onError: (error) => onError({ error, fallbackKey: 'budgets.lines.notifications.deleteError' }),
    onSettled: invalidate,
  });

  const deleteAllLines = useMutation({
    mutationFn: async ({ lineIds }: { lineIds: string[] }) => {
      const results = await Promise.allSettled(
        lineIds.map((lineId) => deleteTrackerLine({ budgetId: toValue(budgetId), lineId })),
      );
      const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failed) throw failed.reason;
    },
    onSuccess: () => addSuccessNotification(t('budgets.lines.notifications.limitsRemoved')),
    onError: (error) => onError({ error, fallbackKey: 'budgets.lines.notifications.deleteError' }),
    onSettled: invalidate,
  });

  return { createLine, updateLine, deleteLine, deleteAllLines };
};
