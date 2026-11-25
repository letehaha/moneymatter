import {
  accountToPortfolioTransfer,
  createDirectCashTransaction,
  createPortfolioTransfer,
  deletePortfolioTransfer,
  exchangeCurrency,
  getTransactionPortfolioLink,
  linkTransactionToPortfolio,
  portfolioToAccountTransfer,
  setTransferAdjustment,
  unlinkTransactionFromPortfolio,
} from '@/api/portfolios';
import { VUE_QUERY_CACHE_KEYS, VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import type { QueryClient } from '@tanstack/vue-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { type MaybeRef, unref } from 'vue';

// Transfer types for external use
export type TransferContext = 'portfolio' | 'account';
export type TransferType = 'portfolio-to-portfolio' | 'portfolio-to-account' | 'account-to-portfolio';

/** Invalidates all queries affected by portfolio transfer operations. */
export function invalidateTransferRelatedQueries(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfolioActivity });
  queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfolioBalances });
  queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfolioSummary });
  queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfolioValueHistory });
  queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfolioAnalytics });
  queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfoliosList });
  queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.allAccounts });
  // Account-to-portfolio and portfolio-to-account transfers create/delete rows in Transactions,
  // so all transactionChange-prefixed consumers (account tx list, widgets, analytics) must refetch.
  queryClient.invalidateQueries({ queryKey: [VUE_QUERY_GLOBAL_PREFIXES.transactionChange] });
}

export const useCreatePortfolioTransfer = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: Parameters<typeof createPortfolioTransfer>[0]) => createPortfolioTransfer(params),
    onSuccess: () => invalidateTransferRelatedQueries(queryClient),
  });
};

export const useAccountToPortfolioTransfer = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: Parameters<typeof accountToPortfolioTransfer>[0]) => accountToPortfolioTransfer(params),
    onSuccess: () => invalidateTransferRelatedQueries(queryClient),
  });
};

export const usePortfolioToAccountTransfer = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: Parameters<typeof portfolioToAccountTransfer>[0]) => portfolioToAccountTransfer(params),
    onSuccess: () => invalidateTransferRelatedQueries(queryClient),
  });
};

export const useCreateDirectCashTransaction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: Parameters<typeof createDirectCashTransaction>[0]) => createDirectCashTransaction(params),
    onSuccess: () => invalidateTransferRelatedQueries(queryClient),
  });
};

export const useExchangeCurrency = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: Parameters<typeof exchangeCurrency>[0]) => exchangeCurrency(params),
    onSuccess: () => invalidateTransferRelatedQueries(queryClient),
  });
};

export const useDeletePortfolioTransfer = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { portfolioId: string; transferId: string; deleteLinkedTransaction?: boolean }) =>
      deletePortfolioTransfer(params),
    onSuccess: () => invalidateTransferRelatedQueries(queryClient),
  });
};

/**
 * Re-classifies a transfer as a balance correction or back into a real
 * contribution. Only the flag moves, so the portfolio balance is untouched and
 * the shared invalidation is enough to refresh the contributions analytics.
 */
export const useSetTransferAdjustment = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: Parameters<typeof setTransferAdjustment>[0]) => setTransferAdjustment(params),
    onSuccess: () => invalidateTransferRelatedQueries(queryClient),
  });
};

export const useLinkTransactionToPortfolio = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: Parameters<typeof linkTransactionToPortfolio>[0]) => linkTransactionToPortfolio(params),
    onSuccess: () => {
      invalidateTransferRelatedQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: [VUE_QUERY_GLOBAL_PREFIXES.transactionChange] });
    },
  });
};

export const useTransactionPortfolioLink = (transactionId: MaybeRef<string | undefined>) => {
  return useQuery({
    queryFn: () => getTransactionPortfolioLink({ transactionId: unref(transactionId)! }),
    queryKey: [...VUE_QUERY_CACHE_KEYS.transactionPortfolioLink, transactionId],
    enabled: () => !!unref(transactionId),
  });
};

export const useUnlinkTransactionFromPortfolio = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { transactionId: string }) => unlinkTransactionFromPortfolio(params),
    onSuccess: () => {
      invalidateTransferRelatedQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: [VUE_QUERY_GLOBAL_PREFIXES.transactionChange] });
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.transactionPortfolioLink });
    },
  });
};
