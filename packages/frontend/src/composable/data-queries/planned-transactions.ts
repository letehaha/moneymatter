import { loadTransactions } from '@/api/transactions';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { SORT_DIRECTIONS, TRANSACTION_SORT_FIELD, TransactionModel } from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import { type MaybeRefOrGetter, computed, toValue } from 'vue';

/** How many pending plans the upcoming surfaces read at once. */
export const PENDING_PLANNED_LIMIT = 20;

const PENDING_PLANNED_KEY = VUE_QUERY_CACHE_KEYS.pendingPlannedTransactions;

/**
 * Planned rows the bank hasn't confirmed yet, oldest first: a merge clears the
 * `isPlanned` flag, so everything this returns is still pending. Oldest-first puts
 * the plans whose match window has run out at the top, where they need attention.
 *
 * No `placeholderData`: it parks the query in `success`, leaving callers unable to tell
 * "still loading" or "failed" apart from "no pending plans".
 */
export const usePendingPlannedTransactions = ({ enabled }: { enabled?: MaybeRefOrGetter<boolean> } = {}) => {
  const query = useQuery({
    queryKey: PENDING_PLANNED_KEY,
    queryFn: () =>
      loadTransactions({
        isPlanned: true,
        limit: PENDING_PLANNED_LIMIT,
        offset: 0,
        sortBy: TRANSACTION_SORT_FIELD.time,
        order: SORT_DIRECTIONS.asc,
      }),
    enabled: computed(() => (enabled === undefined ? true : toValue(enabled))),
    staleTime: 60_000,
  });

  const plans = computed<TransactionModel[]>(() => query.data.value ?? []);

  return { ...query, plans };
};
