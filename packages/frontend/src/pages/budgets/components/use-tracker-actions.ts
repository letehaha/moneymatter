import { archiveBudget, deleteBudget, duplicateBudget, editBudget } from '@/api/budgets';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useNotificationCenter } from '@/components/notification-center';
import { notifyMutationError } from '@/composable/data-queries/use-invalidating-mutation';
import { useAiFeatureAccess } from '@/composable/use-ai-feature-access';
import { ApiErrorResponseError } from '@/js/errors';
import { captureException } from '@/lib/sentry';
import { ROUTES_NAMES } from '@/routes/constants';
import { useUserStore } from '@/stores';
import { AI_FEATURE, BUDGET_STATUSES, type BudgetModel } from '@bt/shared/types';
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

/** Turning smart tracking on may start its trial, which changes the plan entitlements and what serves the AI. */
export const useRefreshSmartTrackingAccess = () => {
  const queryClient = useQueryClient();
  const userStore = useUserStore();
  const { isPlanGated } = useAiFeatureAccess({ aiFeature: AI_FEATURE.trackerMatching });

  return ({ aiEnabled }: { aiEnabled?: boolean }) => {
    if (!aiEnabled || !isPlanGated.value) return;
    userStore.loadUser().catch((error) => captureException({ error, context: { scope: 'tracker:refresh-access' } }));
    void queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.aiFeaturesStatus });
  };
};

export const reportTrackerError = ({
  error,
  fallbackKey,
  context,
}: {
  error: unknown;
  fallbackKey: string;
  context: Record<string, unknown>;
}) => {
  notifyMutationError({ error, fallbackKey });
  if (!(error instanceof ApiErrorResponseError)) captureException({ error, context });
};

export const useTrackerActions = () => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { t } = useI18n();
  const { addSuccessNotification } = useNotificationCenter();
  const invalidateTracker = useInvalidateTracker();

  const archive = useMutation({
    mutationFn: ({ budgetId }: { budgetId: string }) => archiveBudget({ budgetId, isArchived: true }),
    onSuccess: (_data, { budgetId }) => {
      addSuccessNotification(t('budgets.list.archiveSuccess'));
      return invalidateTracker({ budgetId });
    },
    onError: (error, { budgetId }) =>
      reportTrackerError({
        error,
        fallbackKey: 'budgets.list.archiveError',
        context: { source: 'trackerArchive', budgetId },
      }),
  });

  const unarchive = useMutation({
    mutationFn: ({ budgetId }: { budgetId: string }) => archiveBudget({ budgetId, isArchived: false }),
    onSuccess: (_data, { budgetId }) => {
      addSuccessNotification(t('budgets.list.unarchiveSuccess'));
      return invalidateTracker({ budgetId });
    },
    onError: (error, { budgetId }) =>
      reportTrackerError({
        error,
        fallbackKey: 'budgets.list.archiveError',
        context: { source: 'trackerUnarchive', budgetId },
      }),
  });

  const duplicate = useMutation({
    mutationFn: ({ budgetId }: { budgetId: string }) => duplicateBudget({ budgetId }),
    onSuccess: (copy) => {
      addSuccessNotification(t('budgets.list.duplicateSuccess'));
      router.push({ name: ROUTES_NAMES.plannedBudgetDetails, params: { id: copy.id }, query: { edit: '1' } });
      return invalidateTracker({ budgetId: copy.id });
    },
    onError: (error, { budgetId }) =>
      reportTrackerError({
        error,
        fallbackKey: 'budgets.list.duplicateError',
        context: { source: 'trackerDuplicate', budgetId },
      }),
  });

  const remove = useMutation({
    mutationFn: ({ budgetId }: { budgetId: string; redirect?: boolean }) => deleteBudget(budgetId),
    onSuccess: async (_data, { budgetId, redirect }) => {
      addSuccessNotification(t('budgets.list.deleteSuccess'));
      // Leave the details page first so the deleted tracker's query is inactive and not refetched into a 404.
      if (redirect) await router.push({ name: ROUTES_NAMES.plannedBudgets });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.sharedWithMe }),
        queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetsList }),
        queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetsListItem }),
      ]);
      queryClient.removeQueries({ predicate: (query) => query.queryKey.includes(budgetId) });
    },
    onError: (error, { budgetId }) =>
      reportTrackerError({
        error,
        fallbackKey: 'budgets.list.deleteError',
        context: { source: 'trackerDelete', budgetId },
      }),
  });

  const dismissArchivePrompt = useMutation({
    mutationFn: ({ budgetId }: { budgetId: string }) =>
      editBudget({ budgetId, payload: { archivePromptDismissed: true } }),
    onSuccess: (_data, { budgetId }) => {
      addSuccessNotification(t('budgets.list.archivePrompt.dismissSuccess'));
      return invalidateTracker({ budgetId });
    },
    onError: (error, { budgetId }) =>
      reportTrackerError({
        error,
        fallbackKey: 'budgets.list.archivePrompt.dismissError',
        context: { source: 'trackerDismissArchivePrompt', budgetId },
      }),
  });

  const toggleArchive = ({ budget }: { budget: BudgetModel }) =>
    (budget.status === BUDGET_STATUSES.archived ? unarchive : archive).mutate({ budgetId: budget.id });

  return { invalidateTracker, archive, unarchive, toggleArchive, duplicate, remove, dismissArchivePrompt };
};
