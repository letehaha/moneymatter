import {
  createPortfolio,
  deletePortfolio,
  getDeletedPortfolios,
  getPortfolio,
  getPortfolios,
  restorePortfolio,
  updatePortfolio,
} from '@/api/portfolios';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { type MaybeRef, unref } from 'vue';

// Portfolio creation composable
export const useCreatePortfolio = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createPortfolio,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfoliosList });
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfolioSummaries });
    },
  });
};

// Portfolio listing composable
export const usePortfolios = (queryOptions = {}) => {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryFn: getPortfolios,
    queryKey: VUE_QUERY_CACHE_KEYS.portfoliosList,
    staleTime: 1000 * 60 * 5, // 5 minutes
    ...queryOptions,
  });

  return {
    ...query,
    invalidate: () => queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfoliosList }),
  };
};

// Individual portfolio composable
export const usePortfolio = (portfolioId: MaybeRef<string | undefined>, queryOptions = {}) => {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryFn: () => getPortfolio({ portfolioId: unref(portfolioId)! }),
    queryKey: [...VUE_QUERY_CACHE_KEYS.portfolioDetails, portfolioId],
    enabled: () => !!unref(portfolioId),
    staleTime: 1000 * 60 * 5, // 5 minutes
    ...queryOptions,
  });

  return {
    ...query,
    invalidate: () =>
      queryClient.invalidateQueries({ queryKey: [...VUE_QUERY_CACHE_KEYS.portfoliosList, unref(portfolioId)] }),
  };
};

// Portfolio update composable
export const useUpdatePortfolio = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: Parameters<typeof updatePortfolio>[0]) => updatePortfolio(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfoliosList });
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfolioDetails });
      // Summary and holdings values depend on the portfolio's displayCurrencyCode
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfolioSummary });
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.holdingsList });
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.transactionPortfolioLink });
    },
  });
};

// Portfolio deletion composable (soft-delete by default)
export const useDeletePortfolio = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (portfolioId: string) => deletePortfolio({ portfolioId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfoliosList });
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfoliosTrashList });
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfolioSummaries });
    },
  });
};

// Soft-deleted (trash) listing
export const useDeletedPortfolios = (queryOptions = {}) => {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryFn: getDeletedPortfolios,
    queryKey: VUE_QUERY_CACHE_KEYS.portfoliosTrashList,
    staleTime: 1000 * 60 * 5,
    ...queryOptions,
  });

  return {
    ...query,
    invalidate: () => queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfoliosTrashList }),
  };
};

// Restore from trash
export const useRestorePortfolio = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (portfolioId: string) => restorePortfolio({ portfolioId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfoliosList });
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfoliosTrashList });
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfolioSummaries });
    },
  });
};

// Permanent (force) delete from trash
export const usePermanentlyDeletePortfolio = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (portfolioId: string) => deletePortfolio({ portfolioId, force: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfoliosList });
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfoliosTrashList });
    },
  });
};
