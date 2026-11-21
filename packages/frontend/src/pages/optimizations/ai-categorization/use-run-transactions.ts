import { loadTransactions } from '@/api/transactions';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const/vue-query';
import { DEFAULT_SORTING, type TableSorting } from '@/components/transactions-table/columns';
import { CATEGORIZATION_SOURCE } from '@bt/shared/types';
import { useInfiniteQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';

const RUN_TRANSACTIONS_PAGE_LIMIT = 30;

/** The transactions one AI categorization run touched, identified by its `categorizedAt` stamp. */
export function useRunTransactions({ categorizedAt }: { categorizedAt: () => string }) {
  const runAt = computed(categorizedAt);
  const sorting = ref<TableSorting>({ ...DEFAULT_SORTING });

  const {
    data: transactionPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetched,
    isLoadingError,
    refetch,
  } = useInfiniteQuery({
    queryKey: [...VUE_QUERY_CACHE_KEYS.aiCategorizationRunTransactions, runAt, sorting],
    queryFn: ({ pageParam }) =>
      loadTransactions({
        limit: RUN_TRANSACTIONS_PAGE_LIMIT,
        offset: pageParam * RUN_TRANSACTIONS_PAGE_LIMIT,
        categorizationSource: CATEGORIZATION_SOURCE.ai,
        categorizedAt: runAt.value,
        sortBy: sorting.value.sortBy,
        order: sorting.value.order,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      if (lastPage.length < RUN_TRANSACTIONS_PAGE_LIMIT) return undefined;
      return pages.length;
    },
  });

  const transactions = computed(() => transactionPages.value?.pages.flat() ?? []);

  const setSorting = (value: TableSorting) => {
    sorting.value = value;
  };

  return {
    sorting,
    setSorting,
    transactions,
    isFetched,
    isLoadingError,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    refetch,
  };
}
