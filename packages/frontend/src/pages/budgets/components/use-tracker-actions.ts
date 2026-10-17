import { archiveBudget, deleteBudget, duplicateBudget, editBudget } from '@/api/budgets';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useNotificationCenter } from '@/components/notification-center';
import { ApiErrorResponseError, extractApiErrorMessage } from '@/js/errors';
import { captureException } from '@/lib/sentry';
import { ROUTES_NAMES } from '@/routes/constants';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

export const useInvalidateTracker = () => {
  const queryClient = useQueryClient();

  return ({ budgetId }: { budgetId: string }) =>
    Promise.all([
      queryClient.invalidateQueries({ predicate: (query) => query.queryKey.includes(budgetId) }),
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetsList }),
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetsListItem }),
    ]);
};

export const useTrackerActions = () => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { t } = useI18n();
  const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
  const invalidateTracker = useInvalidateTracker();

  const reportError = ({
    error,
    fallbackKey,
    source,
    budgetId,
  }: {
    error: unknown;
    fallbackKey: string;
    source: string;
    budgetId: string;
  }) => {
    addErrorNotification(extractApiErrorMessage(error) || t(fallbackKey));
    if (!(error instanceof ApiErrorResponseError)) captureException({ error, context: { source, budgetId } });
  };

  const archive = useMutation({
    mutationFn: ({ budgetId }: { budgetId: string }) => archiveBudget({ budgetId, isArchived: true }),
    onSuccess: (_data, { budgetId }) => {
      addSuccessNotification(t('budgets.list.archiveSuccess'));
      return invalidateTracker({ budgetId });
    },
    onError: (error, { budgetId }) =>
      reportError({ error, fallbackKey: 'budgets.list.archiveError', source: 'trackerArchive', budgetId }),
  });

  const unarchive = useMutation({
    mutationFn: ({ budgetId }: { budgetId: string }) => archiveBudget({ budgetId, isArchived: false }),
    onSuccess: (_data, { budgetId }) => {
      addSuccessNotification(t('budgets.list.unarchiveSuccess'));
      return invalidateTracker({ budgetId });
    },
    onError: (error, { budgetId }) =>
      reportError({ error, fallbackKey: 'budgets.list.archiveError', source: 'trackerUnarchive', budgetId }),
  });

  const duplicate = useMutation({
    mutationFn: ({ budgetId }: { budgetId: string }) => duplicateBudget({ budgetId }),
    onSuccess: (copy) => {
      addSuccessNotification(t('budgets.list.duplicateSuccess'));
      router.push({ name: ROUTES_NAMES.plannedBudgetDetails, params: { id: copy.id }, query: { edit: '1' } });
      return invalidateTracker({ budgetId: copy.id });
    },
    onError: (error, { budgetId }) =>
      reportError({ error, fallbackKey: 'budgets.list.duplicateError', source: 'trackerDuplicate', budgetId }),
  });

  const remove = useMutation({
    mutationFn: ({ budgetId }: { budgetId: string; redirect?: boolean }) => deleteBudget(budgetId),
    onSuccess: async (_data, { budgetId, redirect }) => {
      addSuccessNotification(t('budgets.list.deleteSuccess'));
      // Leave the details page first so the deleted tracker's query is inactive and not refetched into a 404.
      if (redirect) await router.push({ name: ROUTES_NAMES.plannedBudgets });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.sharedWithMe }),
        invalidateTracker({ budgetId }),
      ]);
    },
    onError: (error, { budgetId }) =>
      reportError({ error, fallbackKey: 'budgets.list.deleteError', source: 'trackerDelete', budgetId }),
  });

  const dismissArchivePrompt = useMutation({
    mutationFn: ({ budgetId }: { budgetId: string }) =>
      editBudget({ budgetId, payload: { archivePromptDismissed: true } }),
    onSuccess: (_data, { budgetId }) => {
      addSuccessNotification(t('budgets.list.archivePrompt.dismissSuccess'));
      return invalidateTracker({ budgetId });
    },
    onError: (error, { budgetId }) =>
      reportError({
        error,
        fallbackKey: 'budgets.list.archivePrompt.dismissError',
        source: 'trackerDismissArchivePrompt',
        budgetId,
      }),
  });

  return { invalidateTracker, archive, unarchive, duplicate, remove, dismissArchivePrompt };
};
