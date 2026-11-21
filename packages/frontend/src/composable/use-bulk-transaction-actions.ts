import type { TransactionFilterParams } from '@/api/transactions';
import { getBankRowPermissions } from '@/common/utils/bank-row-permissions';
import type { BulkEditFormValues } from '@/components/transactions-list/bulk-edit-dialog.vue';
import { useAccountsStore } from '@/stores';
import {
  type AccountModel,
  type TransactionModel,
  type TransactionsSummaryResponse,
  type BulkTarget,
} from '@bt/shared/types';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';

import {
  subtractTotals,
  sumSelectedTotals,
  useBulkSelectability,
  useTransactionSelection,
} from './transaction-selection';
import { useBulkDeleteTransactions } from './use-bulk-delete-transactions';
import { useBulkUpdateCategory } from './use-bulk-update-category';

// The backend deletes both legs of a transfer, so a locked opposite leg blocks the row too.
export const isUndeletableTx = ({
  tx,
  oppositeTx,
  accountsRecord,
}: {
  tx: TransactionModel;
  oppositeTx: TransactionModel | undefined;
  accountsRecord: Record<string, AccountModel | undefined>;
}) =>
  [tx, oppositeTx].some(
    (leg) => !!leg && !getBankRowPermissions({ transaction: leg, account: accountsRecord[leg.accountId] }).canDelete,
  );

/** The whole result set behind the loaded rows: its totals and the filters that produce it. */
export interface MatchingTransactions {
  summary: TransactionsSummaryResponse;
  filters: TransactionFilterParams;
}

/** What a bulk request targets: the filter selection while select-all is on, else the ticked ids. */
export function buildBulkTarget({
  matching,
  excludedIds,
  selectedIds,
}: {
  matching: MatchingTransactions | undefined;
  excludedIds: string[];
  selectedIds: string[];
}): BulkTarget {
  return matching ? { selection: { filters: matching.filters, excludedIds } } : { transactionIds: selectedIds };
}

/**
 * The full bulk-operations surface shared by the transactions list and table
 * views: row selection, eligibility (shared-account / external lockouts), the
 * bulk update & delete mutations, and the open-state of every bulk dialog.
 * Pair it with `BulkActionDialogs`, which hosts the dialogs this state drives —
 * the views only keep their own toolbars (presentation genuinely differs).
 */
export function useBulkTransactionActions({
  getTransactions,
  getScopeKey,
  getMatching,
  getHasNextPage,
}: {
  getTransactions: () => TransactionModel[];
  getScopeKey?: () => string | undefined;
  /** When given, "select all" covers the whole result set, not only the loaded rows. */
  getMatching?: () => MatchingTransactions | undefined;
  getHasNextPage?: () => boolean;
}) {
  const { accountsRecord } = storeToRefs(useAccountsStore());
  const { isBulkSelectable, getUnselectableReason } = useBulkSelectability();

  const selection = useTransactionSelection({
    getTransactions,
    getScopeKey,
    isExtraSelectable: isBulkSelectable,
  });

  // ponytail: only finds an opposite leg that is loaded; the backend still rejects one that is not.
  const hasUndeletableSelected = computed(() => {
    const selectedIds = new Set(selection.getSelectedTransactionIds());
    if (selectedIds.size === 0) return false;
    const transactions = getTransactions();
    return transactions.some(
      (tx) =>
        selectedIds.has(tx.id) &&
        isUndeletableTx({
          tx,
          oppositeTx: tx.transferId
            ? transactions.find((leg) => leg.transferId === tx.transferId && leg.id !== tx.id)
            : undefined,
          accountsRecord: accountsRecord.value,
        }),
    );
  });

  const allMatching = computed(() => (selection.isSelectAllActive.value ? getMatching?.() : undefined));

  // Loaded rows the user cannot tick are part of the result set but never of the selection.
  const excludedIds = computed(() => {
    const ids = new Set(selection.excludedIds.value);
    for (const tx of getTransactions()) {
      if (!selection.isTransactionSelectable(tx)) ids.add(tx.id);
    }
    return ids;
  });

  const selectedCount = computed(() =>
    allMatching.value
      ? Math.max(allMatching.value.summary.count - excludedIds.value.size, 0)
      : selection.selectedCount.value,
  );

  const selectedTotals = computed(() => {
    const transactions = getTransactions();
    if (!allMatching.value) return sumSelectedTotals({ transactions, selectedIds: selection.selectedIds.value });

    return subtractTotals({
      from: allMatching.value.summary,
      minus: sumSelectedTotals({ transactions, selectedIds: excludedIds.value }),
    });
  });

  // Grouping needs the id of every selected row, which unloaded rows do not have yet.
  const isGroupingBlocked = computed(() => !!allMatching.value && !!getHasNextPage?.());

  const getBulkTarget = () =>
    buildBulkTarget({
      matching: allMatching.value,
      excludedIds: [...excludedIds.value],
      selectedIds: selection.getSelectedTransactionIds(),
    });

  // Checkbox tri-state for "select all" headers (the list toolbar only needs
  // the boolean `isAllSelected`).
  const selectAllState = computed<boolean | 'indeterminate'>(() => {
    if (selection.selectedCount.value === 0) return false;
    if (selection.isAllSelected.value) return true;
    return 'indeterminate';
  });

  const handleSelectAllToggle = (checked: boolean | 'indeterminate') => {
    if (checked === true) {
      selection.selectAll();
    } else {
      selection.clearSelection();
    }
  };

  const isBulkEditDialogOpen = ref(false);
  const isCreateGroupDialogOpen = ref(false);
  const isAddToGroupDialogOpen = ref(false);
  const isBulkDeleteDialogOpen = ref(false);

  const bulkUpdateMutation = useBulkUpdateCategory({
    onSuccess: () => {
      selection.clearSelection();
      isBulkEditDialogOpen.value = false;
    },
  });

  const bulkDeleteMutation = useBulkDeleteTransactions({
    onSuccess: () => {
      selection.clearSelection();
      isBulkDeleteDialogOpen.value = false;
    },
  });

  const isBulkLoading = computed(() => bulkUpdateMutation.isPending.value || bulkDeleteMutation.isPending.value);

  const handleBulkApply = (values: BulkEditFormValues) => {
    bulkUpdateMutation.mutate({ ...getBulkTarget(), ...values });
  };

  const handleBulkDelete = () => {
    bulkDeleteMutation.mutate(getBulkTarget());
  };

  return {
    ...selection,
    selectedCount,
    isGroupingBlocked,
    getUnselectableReason,
    hasUndeletableSelected,
    selectedTotals,
    selectAllState,
    handleSelectAllToggle,
    isBulkEditDialogOpen,
    isCreateGroupDialogOpen,
    isAddToGroupDialogOpen,
    isBulkDeleteDialogOpen,
    bulkUpdateMutation,
    bulkDeleteMutation,
    isBulkLoading,
    handleBulkApply,
    handleBulkDelete,
  };
}

export type BulkTransactionActions = ReturnType<typeof useBulkTransactionActions>;
