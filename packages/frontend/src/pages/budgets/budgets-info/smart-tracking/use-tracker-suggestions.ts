import { loadTrackerSuggestions } from '@/api/budgets';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { SSE_EVENT_TYPES, useSSE } from '@/composable/use-sse';
import type { TrackerSuggestionsResponse } from '@bt/shared/types';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { type MaybeRefOrGetter, computed, onScopeDispose, toValue } from 'vue';

import { useInvalidateTracker } from '../../components/use-tracker-actions';

const suggestionsKey = ({ budgetId }: { budgetId: string }) => [...VUE_QUERY_CACHE_KEYS.budgetSuggestions, budgetId];

export const useTrackerSuggestions = ({
  budgetId,
  enabled,
}: {
  budgetId: MaybeRefOrGetter<string>;
  enabled: MaybeRefOrGetter<boolean>;
}) =>
  useQuery({
    queryKey: computed(() => suggestionsKey({ budgetId: toValue(budgetId) })),
    queryFn: () => loadTrackerSuggestions({ budgetId: toValue(budgetId) }),
    enabled: computed(() => toValue(enabled)),
    staleTime: 30_000,
  });

export const useTrackerScanEvents = ({ budgetId }: { budgetId: MaybeRefOrGetter<string> }) => {
  const queryClient = useQueryClient();
  const invalidateTracker = useInvalidateTracker();

  const unsubscribe = useSSE().on(SSE_EVENT_TYPES.TRACKER_SCAN_STATUS, ({ budgetId: eventBudgetId, status }) => {
    if (eventBudgetId !== toValue(budgetId)) return;
    const queryKey = suggestionsKey({ budgetId: eventBudgetId });

    if (status === 'done' || status === 'failed') {
      invalidateTracker({ budgetId: eventBudgetId });
      return;
    }

    queryClient.setQueryData<TrackerSuggestionsResponse>(queryKey, (previous) =>
      previous
        ? {
            ...previous,
            scan: {
              ...previous.scan,
              status,
              startedAt: status === 'running' ? (previous.scan.startedAt ?? new Date()) : previous.scan.startedAt,
            },
          }
        : previous,
    );
    queryClient.invalidateQueries({ queryKey });
  });

  onScopeDispose(unsubscribe);
};
