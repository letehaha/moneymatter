import {
  HoldingTransactionsResponse,
  createInvestmentTransaction,
  deleteInvestmentTransaction,
  getHoldingTransactions,
} from '@/api/investment-transactions';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { MaybeRef, type MaybeRefOrGetter, computed, toRef, toValue } from 'vue';

import { invalidatePortfolioState } from './invalidate-portfolio-state';

// Composable for creating an investment transaction
export const useCreateInvestmentTransaction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createInvestmentTransaction,
    onSuccess: () => {
      invalidatePortfolioState({ queryClient });
    },
  });
};

export const useDeleteInvestmentTransaction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteInvestmentTransaction,
    onSuccess: () => {
      invalidatePortfolioState({ queryClient });
    },
  });
};

export const useGetHoldingTransactionsInfinite = (
  portfolioId: MaybeRef<string | undefined>,
  securityId: MaybeRef<string | undefined>,
  pageSize = 30,
) => {
  const portfolioIdRef = toRef(portfolioId);
  const securityIdRef = toRef(securityId);

  return useInfiniteQuery<HoldingTransactionsResponse>({
    queryKey: [...VUE_QUERY_CACHE_KEYS.holdingTransactions, 'infinite', portfolioIdRef, securityIdRef, pageSize],
    queryFn: ({ pageParam = 0 }) =>
      getHoldingTransactions({
        portfolioId: portfolioIdRef.value!,
        securityId: securityIdRef.value!,
        limit: pageSize,
        offset: pageParam as number,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const loadedSoFar = lastPage.offset + lastPage.transactions.length;
      return loadedSoFar < lastPage.total ? loadedSoFar : undefined;
    },
    enabled: computed(() => !!portfolioIdRef.value && !!securityIdRef.value),
  });
};

const MAX_TRANSACTIONS_PAGE_SIZE = 100;

/** Pages until the reported total arrives; a page without a total, or running dry early, throws instead of truncating. */
export const fetchAllTransactionPages = async ({
  fetchPage,
  pageSize,
}: {
  fetchPage: ({ limit, offset }: { limit: number; offset: number }) => Promise<HoldingTransactionsResponse>;
  pageSize: number;
}) => {
  const transactions: HoldingTransactionsResponse['transactions'] = [];
  let total = Infinity;
  while (transactions.length < total) {
    const page = await fetchPage({ limit: pageSize, offset: transactions.length });
    if (typeof page.total !== 'number' || !Number.isFinite(page.total)) {
      throw new Error('Holding transactions page is missing its total');
    }
    total = page.total;
    if (page.transactions.length === 0) {
      if (transactions.length < total) throw new Error('Holding transactions ended before the reported total');
      break;
    }
    transactions.push(...page.transactions);
  }
  return transactions;
};

/** Every transaction of the holding, newest first; pages through the API's size cap. */
export const useAllHoldingTransactions = ({
  portfolioId,
  securityId,
}: {
  portfolioId: MaybeRefOrGetter<string>;
  securityId: MaybeRefOrGetter<string>;
}) =>
  useQuery({
    queryKey: computed(
      () => [...VUE_QUERY_CACHE_KEYS.holdingTransactions, 'all', toValue(portfolioId), toValue(securityId)] as const,
    ),
    queryFn: () =>
      fetchAllTransactionPages({
        pageSize: MAX_TRANSACTIONS_PAGE_SIZE,
        fetchPage: ({ limit, offset }) =>
          getHoldingTransactions({ portfolioId: toValue(portfolioId), securityId: toValue(securityId), limit, offset }),
      }),
    enabled: computed(() => Boolean(toValue(portfolioId)) && Boolean(toValue(securityId))),
  });
