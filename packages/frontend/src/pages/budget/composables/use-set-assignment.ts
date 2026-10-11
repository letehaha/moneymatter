import { setBudgetPlanAssignment } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useNotificationCenter } from '@/components/notification-center';
import { notifyMutationError } from '@/composable/data-queries/use-invalidating-mutation';
import { hashKey, useMutation, useQueryClient } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';

export const useSetAssignment = ({ onSuccess }: { onSuccess?: () => void } = {}) => {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { addSuccessNotification } = useNotificationCenter();

  return useMutation({
    mutationFn: setBudgetPlanAssignment,
    onSuccess: (view, { planId }) => {
      const viewKey = [...VUE_QUERY_CACHE_KEYS.budgetPlanPeriodView, planId, view.period.id];
      queryClient.setQueryData(viewKey, view);
      // The response is the fresh view, so everything else under the plan refetches but this one.
      queryClient.invalidateQueries({
        queryKey: VUE_QUERY_CACHE_KEYS.budgetPlans,
        predicate: (query) => query.queryHash !== hashKey(viewKey),
      });
      addSuccessNotification(t('budgetPlans.assign.saved'));
      onSuccess?.();
    },
    onError: (error) => notifyMutationError({ error, fallbackKey: 'budgetPlans.assign.error' }),
  });
};
