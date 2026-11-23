import { setBudgetPlanAssignment } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useNotificationCenter } from '@/components/notification-center';
import { notifyMutationError } from '@/composable/data-queries/use-invalidating-mutation';
import type { BudgetPlanPeriodView } from '@bt/shared/types';
import { type QueryClient, hashKey, useMutation, useQueryClient } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';

/** Caches the fresh period view from a save and refetches everything else under the plan. */
export const cacheSavedPeriodView = ({
  queryClient,
  planId,
  view,
}: {
  queryClient: QueryClient;
  planId: string;
  view: BudgetPlanPeriodView;
}) => {
  const viewKey = [...VUE_QUERY_CACHE_KEYS.budgetPlanPeriodView, planId, view.period.id];
  queryClient.setQueryData(viewKey, view);
  queryClient.invalidateQueries({
    queryKey: VUE_QUERY_CACHE_KEYS.budgetPlans,
    predicate: (query) => query.queryHash !== hashKey(viewKey),
  });
};

export const useSetAssignment = ({ onSuccess }: { onSuccess?: () => void } = {}) => {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { addSuccessNotification } = useNotificationCenter();

  return useMutation({
    mutationFn: setBudgetPlanAssignment,
    onSuccess: (view, { planId }) => {
      cacheSavedPeriodView({ queryClient, planId, view });
      addSuccessNotification(t('budgetPlans.assign.saved'));
      onSuccess?.();
    },
    onError: (error) => notifyMutationError({ error, fallbackKey: 'budgetPlans.assign.error' }),
  });
};
