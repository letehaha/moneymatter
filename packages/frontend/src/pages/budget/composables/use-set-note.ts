import { setBudgetPlanLineNote, setBudgetPlanPeriodNote } from '@/api/budget-plans';
import { notifyMutationError } from '@/composable/data-queries/use-invalidating-mutation';
import type { SetBudgetPlanNotePayload } from '@bt/shared/types';
import { useMutation, useQueryClient } from '@tanstack/vue-query';

import { cacheSavedPeriodView } from './use-set-assignment';

export const useSetNote = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      lineId,
      ...rest
    }: {
      planId: string;
      periodId: string;
      lineId?: string;
      payload: SetBudgetPlanNotePayload;
    }) => (lineId ? setBudgetPlanLineNote({ ...rest, lineId }) : setBudgetPlanPeriodNote(rest)),
    onSuccess: (view, { planId }) => cacheSavedPeriodView({ queryClient, planId, view }),
    onError: (error) => notifyMutationError({ error, fallbackKey: 'budgetPlans.panel.note.error' }),
  });
};
