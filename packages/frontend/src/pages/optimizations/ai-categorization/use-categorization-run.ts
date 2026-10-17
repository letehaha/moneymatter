import { getAiCategorizationCandidates, triggerAiCategorization } from '@/api/ai-categorization';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const/vue-query';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { DEFAULT_SORTING, type TableSorting } from '@/components/transactions-table/columns';
import { useAiAllowance } from '@/composable/use-ai-allowance';
import { useCategorizationStatus } from '@/composable/use-categorization-status';
import { useDateLocale } from '@/composable/use-date-locale';
import { extractApiErrorMessage, isApiErrorWithCode } from '@/js/errors';
import { AI_CATEGORIZATION_MAX_TRANSACTIONS_PER_RUN, AI_FEATURE, API_ERROR_CODES } from '@bt/shared/types';
import { useInfiniteQuery, useMutation } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const RATE_LIMIT_FALLBACK_SECONDS = 60 * 60;
const CANDIDATES_PAGE_LIMIT = 30;

/**
 * The whole run surface: the candidate list, the total it reports, the trigger
 * mutation and the live run status.
 */
export function useCategorizationRun() {
  const { t } = useI18n();
  const { addNotification } = useNotificationCenter();
  const { formatDistance } = useDateLocale();
  const { isCategorizing, progress, categorizationStatus } = useCategorizationStatus();
  const { isReached } = useAiAllowance();

  const sorting = ref<TableSorting>({ ...DEFAULT_SORTING });

  const {
    data: candidatePages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetched: isCandidatesFetched,
    isLoadingError: candidatesUnavailable,
    refetch: refetchCandidates,
  } = useInfiniteQuery({
    queryKey: [...VUE_QUERY_CACHE_KEYS.aiCategorizationCandidates, sorting],
    queryFn: ({ pageParam }) =>
      getAiCategorizationCandidates({
        limit: CANDIDATES_PAGE_LIMIT,
        offset: pageParam * CANDIDATES_PAGE_LIMIT,
        sortBy: sorting.value.sortBy,
        order: sorting.value.order,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      if (lastPage.items.length < CANDIDATES_PAGE_LIMIT) return undefined;
      return pages.length;
    },
  });

  const candidates = computed(() => candidatePages.value?.pages.flatMap((page) => page.items) ?? []);

  /**
   * Only the first page carries the total. `null` means "not known yet" — an
   * absent total must never be read as zero, or a failed load renders as
   * "everything is categorized".
   */
  const totalCount = computed(() => candidatePages.value?.pages[0]?.totalCount ?? null);
  const isCountKnown = computed(() => totalCount.value !== null);
  const countLabel = computed(() => totalCount.value?.toLocaleString() ?? '');
  const exceedsRunCap = computed(() => (totalCount.value ?? 0) > AI_CATEGORIZATION_MAX_TRANSACTIONS_PER_RUN);
  const isEverythingCategorized = computed(() => totalCount.value === 0);

  const setSorting = (value: TableSorting) => {
    sorting.value = value;
  };

  const formatRetryDelay = ({ seconds }: { seconds: number }) => formatDistance(0, seconds * 1000);

  const { mutate: trigger, isPending: isTriggering } = useMutation({
    mutationFn: ({ transactionIds }: { transactionIds?: string[] }) => triggerAiCategorization({ transactionIds }),
    onSuccess: (result) => {
      addNotification(
        result.enqueued
          ? {
              text: t('optimizations.aiCategorization.notifications.started', { count: result.totalCount }),
              type: NotificationType.success,
            }
          : {
              text: t('optimizations.aiCategorization.notifications.nothingToCategorize'),
              type: NotificationType.info,
            },
      );
    },
    onError: (error) => {
      if (isApiErrorWithCode(error, API_ERROR_CODES.conflict)) {
        addNotification({
          text: t('optimizations.aiCategorization.notifications.alreadyRunning'),
          type: NotificationType.info,
        });
        return;
      }

      if (isApiErrorWithCode(error, API_ERROR_CODES.tooManyRequests)) {
        const retryAfter = error.data.details?.retryAfter;
        const seconds = typeof retryAfter === 'number' ? retryAfter : RATE_LIMIT_FALLBACK_SECONDS;
        addNotification({
          text: t('optimizations.aiCategorization.notifications.rateLimited', { time: formatRetryDelay({ seconds }) }),
          type: NotificationType.error,
        });
        return;
      }

      addNotification({
        text: extractApiErrorMessage(error) || t('optimizations.aiCategorization.notifications.failed'),
        type: NotificationType.error,
      });
    },
  });

  // The SSE `queued` event lands right after a successful trigger and keeps the
  // button locked for the whole run.
  const isBusy = computed(() => isTriggering.value || isCategorizing.value);
  const isRunDisabled = computed(
    () =>
      isBusy.value ||
      !isCountKnown.value ||
      isEverythingCategorized.value ||
      isReached({ feature: AI_FEATURE.categorization }),
  );

  const processedLabel = computed(() => {
    const status = categorizationStatus.value;
    if (!status) return null;
    return t('optimizations.aiCategorization.run.processed', {
      processed: status.processedCount.toLocaleString(),
      total: status.totalCount.toLocaleString(),
    });
  });

  return {
    sorting,
    setSorting,
    candidates,
    candidatesUnavailable,
    isCandidatesFetched,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    refetchCandidates,
    totalCount,
    isCountKnown,
    countLabel,
    exceedsRunCap,
    isEverythingCategorized,
    isCategorizing,
    progress,
    processedLabel,
    isBusy,
    isRunDisabled,
    trigger,
  };
}

export type CategorizationRun = ReturnType<typeof useCategorizationRun>;
