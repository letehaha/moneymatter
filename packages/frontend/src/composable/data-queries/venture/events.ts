import {
  createVentureEvent,
  deleteVentureEvent,
  getTransactionVentureLink,
  listVentureEvents,
} from '@/api/venture/events';
import { VUE_QUERY_CACHE_KEYS, VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { TRANSACTION_TRANSFER_NATURE, type TransactionModel } from '@bt/shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { type MaybeRefOrGetter, computed, toValue } from 'vue';

type DealIdSource = MaybeRefOrGetter<string | undefined>;

const eventsKey = (dealId: DealIdSource) => [...VUE_QUERY_CACHE_KEYS.ventureDealEvents, dealId];

export const useVentureEvents = (dealId: DealIdSource, queryOptions = {}) => {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryFn: () => listVentureEvents({ dealId: toValue(dealId)! }),
    queryKey: eventsKey(dealId),
    enabled: () => !!toValue(dealId),
    staleTime: 1000 * 30,
    ...queryOptions,
  });

  return {
    ...query,
    invalidate: () => queryClient.invalidateQueries({ queryKey: eventsKey(toValue(dealId)) }),
  };
};

/**
 * Invalidates everything touched by an event mutation: every venture-prefixed
 * query (events list, deal details, metrics, deals list, balance trend) plus
 * any transaction-derived queries (linked-mode events create/restore real
 * transactions, so balances and tx lists must refresh).
 */
const invalidateAllForDeal = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({
    predicate: (q) =>
      Array.isArray(q.queryKey) &&
      (q.queryKey.includes(VUE_QUERY_GLOBAL_PREFIXES.ventureChange) ||
        q.queryKey.includes(VUE_QUERY_GLOBAL_PREFIXES.transactionChange)),
  });
};

export const useCreateVentureEvent = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createVentureEvent,
    onSuccess: () => invalidateAllForDeal(queryClient),
  });
};

export const useDeleteVentureEvent = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteVentureEvent,
    onSuccess: () => invalidateAllForDeal(queryClient),
  });
};

/** Resolves the venture deal behind a venture-linked transaction; idle for any other transaction. */
export const useTransactionVentureLink = (transaction: MaybeRefOrGetter<TransactionModel | undefined>) => {
  const transactionId = computed(() => {
    const tx = toValue(transaction);
    return tx?.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_venture ? tx.id : undefined;
  });

  return useQuery({
    queryFn: () => getTransactionVentureLink({ transactionId: transactionId.value! }),
    queryKey: [...VUE_QUERY_CACHE_KEYS.transactionVentureLink, transactionId],
    enabled: () => !!transactionId.value,
  });
};
