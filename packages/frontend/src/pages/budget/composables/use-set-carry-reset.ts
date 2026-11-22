import { setBudgetPlanCarryReset } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useNotificationCenter } from '@/components/notification-center';
import { notifyMutationError } from '@/composable/data-queries/use-invalidating-mutation';
import { hashKey, useMutation, useQueryClient } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';

export const useSetCarryReset = ({ onSuccess }: { onSuccess?: () => void } = {}) => {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { addSuccessNotification } = useNotificationCenter();

  return useMutation({
    mutationFn: setBudgetPlanCarryReset,
    onSuccess: (view, { planId, payload }) => {
      const viewKey = [...VUE_QUERY_CACHE_KEYS.budgetPlanPeriodView, planId, view.period.id];
      queryClient.setQueryData(viewKey, view);
      queryClient.invalidateQueries({
        queryKey: VUE_QUERY_CACHE_KEYS.budgetPlans,
        predicate: (query) => query.queryHash !== hashKey(viewKey),
      });
      addSuccessNotification(t(payload.reset ? 'budgetPlans.carryReset.resetDone' : 'budgetPlans.carryReset.undone'));
      onSuccess?.();
    },
    onError: (error) => notifyMutationError({ error, fallbackKey: 'budgetPlans.carryReset.error' }),
  });
};
