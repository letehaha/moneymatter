import { useAccountsStore } from '@/stores';
import { TransactionModel, sumTransactionTotals } from '@bt/shared/types';
import { storeToRefs } from 'pinia';
import { computed, ref, triggerRef, watch } from 'vue';

import { useShiftMultiSelect } from './shift-multi-select';

/** Why a row is locked out of bulk selection; rows render it as an explainer tooltip in place of the checkbox. */
export type BulkUnselectableReason = 'sharedAccount';

/**
 * Per-row bulk-selection eligibility shared by the transactions list and table.
 *
 * Transactions on accounts shared *with* the caller are locked out — the bulk
 * endpoints filter by `userId`, so including them silently no-ops and surfaces
 * a confusing "0 transactions updated" toast. Owner-side shares
 * (`share.isOwner === true`) stay bulk-editable.
 */
export function useBulkSelectability() {
  const { accountsRecord } = storeToRefs(useAccountsStore());

  const isBulkSelectable = (tx: TransactionModel) => {
    const share = accountsRecord.value[tx.accountId]?.share;
    return !share || share.isOwner;
  };

  const getUnselectableReason = (tx: TransactionModel): BulkUnselectableReason | null => {
    if (!isBulkSelectable(tx)) return 'sharedAccount';
    return null;
  };

  return { isBulkSelectable, getUnselectableReason };
}

interface UseTransactionSelectionOptions {
  getTransactions: () => TransactionModel[];
  /**
   * Optional caller-supplied predicate that locks out rows the downstream bulk
   * endpoint can't handle, so the toolbar never offers an action that silently
   * no-ops on submit.
   */
  isExtraSelectable?: (tx: TransactionModel) => boolean;
  /**
   * Identity of the result set the rows come from — filters plus sorting. A new
   * identity restarts the infinite query at page one, so the selection is
   * cleared outright instead of pruned down to the rows that page still holds.
   */
  getScopeKey?: () => string | undefined;
}

/**
 * Selected ids that are no longer among the loaded rows. An empty `loadedIds`
 * yields nothing on purpose: both views are infinite-scroll, so a momentarily
 * empty list means a refetch is in flight, not that the user's selection is gone.
 */
export function getVanishedSelectedIds({
  selectedIds,
  loadedIds,
}: {
  selectedIds: Iterable<string>;
  loadedIds: string[];
}): string[] {
  if (loadedIds.length === 0) return [];
  const loaded = new Set(loadedIds);
  return Array.from(selectedIds).filter((id) => !loaded.has(id));
}

export interface SelectedTotals {
  income: number;
  expense: number;
  net: number;
  /** Amount moved by selected transfer rows. Reported apart from income/expense, never folded into net. */
  transfers: number;
}

/** Totals of the selected rows, in base currency (`refAmount`). */
export function sumSelectedTotals({
  transactions,
  selectedIds,
}: {
  transactions: TransactionModel[];
  selectedIds: Set<string>;
}): SelectedTotals {
  return sumTransactionTotals(transactions.filter((tx) => selectedIds.has(tx.id)));
}

export function subtractTotals({ from, minus }: { from: SelectedTotals; minus: SelectedTotals }): SelectedTotals {
  const income = from.income - minus.income;
  const expense = from.expense - minus.expense;

  return { income, expense, net: income - expense, transfers: from.transfers - minus.transfers };
}

export function useTransactionSelection({
  getTransactions,
  isExtraSelectable,
  getScopeKey,
}: UseTransactionSelectionOptions) {
  // Use ref with Set for better reactivity tracking
  const selectedIds = ref(new Set<string>());

  // Wrapper to trigger reactivity when Set is modified
  const triggerUpdate = () => triggerRef(selectedIds);

  const { handleSelection, resetSelection, isShiftKeyPressed } = useShiftMultiSelect(selectedIds.value, triggerUpdate);

  const selectedCount = computed(() => selectedIds.value.size);

  /**
   * "Select all" was ticked: the selection means every row of the result set, loaded
   * or not, minus the rows unticked since. Rows that load later arrive selected.
   */
  const isSelectAllActive = ref(false);
  /**
   * Rows unticked while select-all is active. Kept apart from `selectedIds` because a row
   * can leave the loaded list (a collapsed section) and must stay unticked when it returns.
   */
  const excludedIds = ref(new Set<string>());

  const isTransactionSelectable = (tx: TransactionModel): boolean => !isExtraSelectable || isExtraSelectable(tx);

  const isAllSelected = computed(() => {
    const transactions = getTransactions();
    const selectableTransactions = transactions.filter(isTransactionSelectable);
    return selectableTransactions.length > 0 && selectedIds.value.size === selectableTransactions.length;
  });

  const isTransactionSelected = (id: string): boolean => {
    return selectedIds.value.has(id);
  };

  const toggleTransaction = ({ value, id }: { value: boolean; id: string }) => {
    const transactions = getTransactions();

    // Filter to only selectable transactions for range selection
    const selectableTransactions = transactions.filter(isTransactionSelectable);
    const selectableIndex = selectableTransactions.findIndex((tx) => tx.id === id);

    if (selectableIndex === -1) return;

    handleSelection(value, id, selectableIndex, selectableTransactions, (tx) => tx.id);

    if (!isSelectAllActive.value) return;
    if (selectedIds.value.size === 0) {
      isSelectAllActive.value = false;
      excludedIds.value = new Set();
      return;
    }
    // Shift-click toggles a whole range, so resync every loaded row, not just `id`.
    const nextExcluded = new Set(excludedIds.value);
    for (const tx of selectableTransactions) {
      if (selectedIds.value.has(tx.id)) nextExcluded.delete(tx.id);
      else nextExcluded.add(tx.id);
    }
    excludedIds.value = nextExcluded;
  };

  const selectAll = () => {
    const transactions = getTransactions();
    transactions.forEach((tx) => {
      if (isTransactionSelectable(tx)) {
        selectedIds.value.add(tx.id);
      }
    });
    isSelectAllActive.value = selectedIds.value.size > 0;
    excludedIds.value = new Set();
    triggerUpdate();
  };

  const clearSelection = () => {
    isSelectAllActive.value = false;
    excludedIds.value = new Set();
    resetSelection();
  };

  const getSelectedTransactionIds = (): string[] => {
    return Array.from(selectedIds.value);
  };

  let observedScopeKey = getScopeKey?.();
  let knownIds = new Set(getTransactions().map((tx) => tx.id));

  watch(
    () => ({ scopeKey: getScopeKey?.(), transactions: getTransactions() }),
    ({ scopeKey, transactions }) => {
      const previouslyKnownIds = knownIds;
      // An empty list is a refetch in flight, not the rows going away: forgetting them
      // here would bring every row back as "newly loaded" and re-tick the unticked ones.
      if (transactions.length > 0) knownIds = new Set(transactions.map((tx) => tx.id));

      if (scopeKey !== observedScopeKey) {
        observedScopeKey = scopeKey;
        if (selectedIds.value.size > 0) clearSelection();
        return;
      }

      if (isSelectAllActive.value) {
        const arrived = transactions.filter(
          (tx) => !previouslyKnownIds.has(tx.id) && !excludedIds.value.has(tx.id) && isTransactionSelectable(tx),
        );
        arrived.forEach((tx) => selectedIds.value.add(tx.id));
        if (arrived.length > 0) triggerUpdate();
      }

      if (selectedIds.value.size === 0) return;

      const vanished = getVanishedSelectedIds({
        selectedIds: selectedIds.value,
        loadedIds: transactions.map((tx) => tx.id),
      });
      if (vanished.length === 0) return;

      vanished.forEach((id) => selectedIds.value.delete(id));
      triggerUpdate();
    },
  );

  return {
    selectedIds,
    selectedCount,
    isAllSelected,
    isSelectAllActive,
    excludedIds,
    isShiftKeyPressed,
    isTransactionSelectable,
    isTransactionSelected,
    toggleTransaction,
    selectAll,
    clearSelection,
    getSelectedTransactionIds,
  };
}
