import { type TransactionFilterParams, loadTransactions, loadTransactionsSummary } from '@/api/transactions';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { DEFAULT_FILTERS, FiltersStruct, SELECTABLE_TRANSFER_NATURES } from '@/components/records-filters/const';
import {
  FILTER_OPERATION,
  SORT_DIRECTIONS,
  TRANSACTION_SORT_FIELD,
  TRANSACTION_TRANSFER_NATURE,
} from '@bt/shared/types';
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/vue-query';
import isDate from 'date-fns/isDate';
import { isEqual, isNil, omitBy } from 'lodash-es';
import { MaybeRef, Ref, computed, ref, toValue } from 'vue';

const filterOrUndefined = (value: FILTER_OPERATION) => (value === FILTER_OPERATION.all ? undefined : value);

/** For tri-state boolean params (`isPlanned`, `hasAttachment`): true = only, false = exclude, absent = both. */
export const buildTriStateParam = ({ value }: { value: FILTER_OPERATION }): boolean | undefined => {
  if (value === FILTER_OPERATION.only) return true;
  if (value === FILTER_OPERATION.exclude) return false;
  return undefined;
};

interface TransactionsSorting {
  sortBy: TRANSACTION_SORT_FIELD;
  order: SORT_DIRECTIONS;
}

const DATE_FILTER_KEYS = new Set<string>(['start', 'end']);

export interface StoredFiltersState {
  filters: Partial<FiltersStruct>;
  sorting?: TransactionsSorting;
}

/** JSON round-trip loses Date instances; `start`/`end` come back as ISO strings and need reviving. */
export const parseStoredFilters = ({ raw }: { raw: string | null }): StoredFiltersState | null => {
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw, (key, value) =>
      DATE_FILTER_KEYS.has(key) && typeof value === 'string' ? new Date(value) : value,
    );
    return stored?.filters && typeof stored.filters === 'object' ? stored : null;
  } catch {
    return null;
  }
};

/**
 * Computes the `transferNatures` query param. Returns undefined when the user's
 * selection doesn't narrow anything (all kinds selected, or transfers excluded
 * entirely — the coarse transferFilter already handles that). Otherwise returns
 * the exact include-list: selected transfer kinds plus `not_transfer`, unless
 * the transfers toggle is "only" (then plain transactions are excluded too).
 */
export const buildTransferNaturesParam = (filter: FiltersStruct): TRANSACTION_TRANSFER_NATURE[] | undefined => {
  const selected = filter.transferNatures;
  const allSelected = SELECTABLE_TRANSFER_NATURES.every((nature) => selected.includes(nature));
  if (allSelected || filter.transferFilter === FILTER_OPERATION.exclude) return undefined;

  return filter.transferFilter === FILTER_OPERATION.only
    ? selected
    : [TRANSACTION_TRANSFER_NATURE.not_transfer, ...selected];
};

/** Which rows match: the query params shared by the list, its summary and filter-based bulk actions. */
export const buildFilterParams = ({ filter }: { filter: FiltersStruct }): TransactionFilterParams =>
  omitBy(
    {
      transactionType: filter.transactionType ?? undefined,
      to: isDate(filter.end) ? filter.end!.toISOString() : undefined,
      from: isDate(filter.start) ? filter.start!.toISOString() : undefined,
      // A zero bound filters nothing, and the API rejects it in a request body.
      amountGte: filter.amountGte || undefined,
      amountLte: filter.amountLte || undefined,
      noteSearch: filter.noteIncludes || undefined,
      hasAttachment: buildTriStateParam({ value: filter.attachmentFilter }),
      transferFilter: filterOrUndefined(filter.transferFilter),
      refundFilter: filterOrUndefined(filter.refundFilter),
      isPlanned: buildTriStateParam({ value: filter.plannedFilter }),
      transferNatures: buildTransferNaturesParam(filter),
      accountIds: filter.accountIds.length ? filter.accountIds : undefined,
      categoryIds: filter.categoryIds.length ? filter.categoryIds : undefined,
      tagIds: filter.tagIds.length ? filter.tagIds : undefined,
      payeeIds: filter.payeeIds.length ? filter.payeeIds : undefined,
      categorizationSource: filter.categorizationSource ?? undefined,
      batchId: filter.batchId ?? undefined,
      budgetIds: filter.budgetIds.length ? filter.budgetIds : undefined,
      excludedBudgetIds: filter.excludedBudgetIds.length ? filter.excludedBudgetIds : undefined,
    },
    isNil,
  ) as TransactionFilterParams;

export const useTransactionsWithFilters = ({
  limit = 30,
  appendQueryKey = [],
  queryEnabled = true,
  staticFilters = {},
  sorting,
  withSummary = false,
}: {
  limit?: number;
  appendQueryKey?: unknown[];
  queryEnabled?: MaybeRef<boolean>;
  staticFilters?: Partial<FiltersStruct>;
  /** Backend-side sorting. When omitted, defaults to time DESC. */
  sorting?: Ref<TransactionsSorting>;
  /** Also fetch count and totals for the whole filtered set. */
  withSummary?: boolean;
} = {}) => {
  const queryClient = useQueryClient();
  const defaultWithStatic = { ...DEFAULT_FILTERS, ...staticFilters };
  const filters = ref<FiltersStruct>({ ...defaultWithStatic });
  const appliedFilters = ref<FiltersStruct>({ ...defaultWithStatic });

  const transactionsListRef = ref<{ scrollToIndex: (index: number) => void } | null>(null);

  const isResetButtonDisabled = computed(() => isEqual(filters.value, defaultWithStatic));
  const isAnyFiltersApplied = computed(() => !isEqual(appliedFilters.value, defaultWithStatic));
  const isFiltersOutOfSync = computed(() => !isEqual(filters.value, appliedFilters.value));

  const resetFilters = () => {
    filters.value = { ...defaultWithStatic };
    appliedFilters.value = { ...defaultWithStatic };
  };

  const applyFilters = () => {
    appliedFilters.value = { ...filters.value };

    if (transactionsListRef.value) {
      transactionsListRef.value.scrollToIndex(0);
    }
  };

  const fetchTransactions = ({ pageParam, filter }: { pageParam: number; filter: FiltersStruct }) => {
    const offset = pageParam * limit;

    return loadTransactions({
      ...buildFilterParams({ filter }),
      limit,
      offset,
      sortBy: sorting?.value.sortBy,
      order: sorting?.value.order,
      includeSplits: true,
      includeTags: true,
      includeGroups: true,
    });
  };

  const queryKey = [
    ...VUE_QUERY_CACHE_KEYS.recordsPageRecordsList,
    appliedFilters,
    ...(sorting ? [sorting] : []),
    ...appendQueryKey,
  ];

  const {
    data: transactionsPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetched,
    isFetching,
  } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchTransactions({ pageParam, filter: appliedFilters.value }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      if (lastPage.length < limit) return undefined;
      return pages.length;
    },
    staleTime: 1_000 * 60,
    // Filters apply as the user edits them — keep the previous result on screen
    // while the re-filtered list loads instead of flashing an empty table.
    placeholderData: keepPreviousData,
    enabled: queryEnabled,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const filterParams = computed(() => buildFilterParams({ filter: appliedFilters.value }));
  const { data: summary } = useQuery({
    queryKey: [...VUE_QUERY_CACHE_KEYS.recordsPageRecordsSummary, appliedFilters, ...appendQueryKey],
    queryFn: () => loadTransactionsSummary(filterParams.value),
    staleTime: 1_000 * 60,
    enabled: computed(() => withSummary && toValue(queryEnabled)),
  });
  const matching = computed(() =>
    summary.value ? { summary: summary.value, filters: filterParams.value } : undefined,
  );

  return {
    isResetButtonDisabled,
    isAnyFiltersApplied,
    isFiltersOutOfSync,
    filters,
    appliedFilters,
    resetFilters,
    applyFilters,
    transactionsPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetched,
    isFetching,
    transactionsListRef,
    invalidate,
    matching,
  };
};
