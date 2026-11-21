import { createGoal, deleteGoal, loadGoal, loadGoals, updateGoal } from '@/api/goals';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import type { API_ERROR_CODES, GoalModel, GoalStatus, RecordId } from '@bt/shared/types';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { type MaybeRefOrGetter, computed, toValue } from 'vue';
import { useI18n } from 'vue-i18n';

import { useInvalidatingMutation } from './use-invalidating-mutation';

export const useGoals = () =>
  useQuery({
    queryKey: VUE_QUERY_CACHE_KEYS.goalsList,
    queryFn: loadGoals,
    staleTime: Infinity,
  });

export const useGoal = ({ goalId }: { goalId: MaybeRefOrGetter<RecordId> }) => {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.goalDetails, toValue(goalId)]),
    queryFn: () => loadGoal({ goalId: toValue(goalId) }),
    placeholderData: () =>
      queryClient
        .getQueryData<GoalModel[]>(VUE_QUERY_CACHE_KEYS.goalsList)
        ?.find((goal) => goal.id === toValue(goalId)),
    staleTime: Infinity,
  });
};

type GoalMutationOptions = {
  /** Codes the caller renders inline (e.g. `goalShareCapacityExceeded`), so no toast is shown. */
  silentErrorCodes?: API_ERROR_CODES[];
};

const SAVED_KEY_BY_STATUS: Record<GoalStatus, string> = {
  active: 'goals.toasts.saved',
  paused: 'goals.toasts.paused',
  archived: 'goals.toasts.archived',
};

export const useCreateGoal = ({ silentErrorCodes }: GoalMutationOptions = {}) =>
  useInvalidatingMutation({
    mutationFn: createGoal,
    invalidateKeys: [VUE_QUERY_CACHE_KEYS.goals],
    successKey: 'goals.toasts.created',
    errorKey: 'goals.toasts.saveError',
    silentErrorCodes,
  });

export const useUpdateGoal = ({ silentErrorCodes }: GoalMutationOptions = {}) => {
  const { t } = useI18n();

  return useInvalidatingMutation({
    mutationFn: updateGoal,
    invalidateKeys: [VUE_QUERY_CACHE_KEYS.goals],
    successMessage: (goal) => t(SAVED_KEY_BY_STATUS[goal.status]),
    errorKey: 'goals.toasts.saveError',
    silentErrorCodes,
  });
};

export const useDeleteGoal = () => {
  const queryClient = useQueryClient();

  return useInvalidatingMutation({
    mutationFn: async ({ goalId }: { goalId: RecordId }) => {
      await deleteGoal({ goalId });
      queryClient.removeQueries({ queryKey: [...VUE_QUERY_CACHE_KEYS.goalDetails, goalId] });
    },
    invalidateKeys: [VUE_QUERY_CACHE_KEYS.goalsList],
    successKey: 'goals.toasts.deleted',
    errorKey: 'goals.toasts.deleteError',
  });
};
