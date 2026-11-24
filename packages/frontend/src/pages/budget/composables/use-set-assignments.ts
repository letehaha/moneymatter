import { setBudgetPlanAssignments } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { notifyMutationError } from '@/composable/data-queries/use-invalidating-mutation';
import { UNDO_VISIBILITY_MS } from '@/composable/use-notify-trashed';
import type { SetBudgetPlanAssignmentsPayload } from '@bt/shared/types';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';

import { cacheSavedPeriodView } from './use-set-assignment';

interface SetAssignmentsVariables {
  planId: string;
  periodId: string;
  payload: SetBudgetPlanAssignmentsPayload;
  /** Success toast text. */
  text: string;
  /** Built from the view before the save; adds an Undo action to the toast. */
  undoPayload?: SetBudgetPlanAssignmentsPayload;
  isUndo?: boolean;
}

export const useSetAssignments = ({ onSuccess }: { onSuccess?: () => void } = {}) => {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationCenter();

  const mutation = useMutation({
    mutationFn: ({ planId, periodId, payload }: SetAssignmentsVariables) =>
      setBudgetPlanAssignments({ planId, periodId, payload }),
    onSuccess: (view, { planId, periodId, text, undoPayload, isUndo }) => {
      cacheSavedPeriodView({ queryClient, planId, view });
      // One id per period, so a newer save replaces the older Undo: undo writes absolute amounts and a stale one
      // would wipe the later save.
      addNotification({
        id: `budget-pool-assignments:${planId}:${periodId}`,
        text,
        type: NotificationType.success,
        visibilityTime: undoPayload ? UNDO_VISIBILITY_MS : undefined,
        action: undoPayload && {
          label: t('common.actions.undo'),
          icon: 'undo',
          onClick: () =>
            mutation.mutate({
              planId,
              periodId,
              payload: undoPayload,
              text: t('budgetPlans.pool.toast.undone'),
              isUndo: true,
            }),
        },
      });
      if (!isUndo) onSuccess?.();
    },
    onError: (error, { isUndo }) => {
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetPlans });
      notifyMutationError({
        error,
        fallbackKey: isUndo ? 'budgetPlans.pool.toast.undoError' : 'budgetPlans.assign.error',
      });
    },
  });

  return mutation;
};
