import { loadTransactionsByTransferId } from '@/api/transactions';
import { VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { isTwoLegTransfer, TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import { type MaybeRefOrGetter, computed, toValue } from 'vue';

const BASE_QUERY_KEY = 'transactions-by-transfer-id';

interface OppositeTxSource {
  id: string;
  transferNature: TRANSACTION_TRANSFER_NATURE;
  transferId: string | null;
}

// Accepts a reactive source (ref/getter) so the query re-evaluates when the
// transaction it tracks is replaced — e.g. a list row transitioning from
// transfer_out_wallet (no transferId) to common_transfer after being linked.
// A plain object is still accepted via toValue for non-reactive callers.
export function useOppositeTxRecord(transaction: MaybeRefOrGetter<OppositeTxSource>) {
  const isTransferTransaction = computed(() => {
    const nature = toValue(transaction).transferNature;
    return isTwoLegTransfer(nature) || nature === TRANSACTION_TRANSFER_NATURE.transfer_out_wallet;
  });

  return useQuery({
    queryKey: computed(() => {
      const tx = toValue(transaction);
      return [VUE_QUERY_GLOBAL_PREFIXES.transactionChange, BASE_QUERY_KEY, tx.id, tx.transferId];
    }),
    queryFn: async () => {
      const tx = toValue(transaction);
      if (!tx.transferId) return null;
      const transactions = await loadTransactionsByTransferId(tx.transferId);
      if (!transactions) return null;
      return transactions.find((item) => item.id !== tx.id) || null;
    },
    enabled: isTransferTransaction,
    staleTime: Infinity,
  });
}
