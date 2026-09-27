<template>
  <div class="flex h-full min-h-0 flex-col">
    <slot
      name="toolbar"
      :selected-count="selectedCount"
      :get-selected-transaction-ids="getSelectedTransactionIds"
      :clear-selection="clearSelection"
      :is-bulk-loading="isBulkLoading"
    >
      <!-- `min-h-12` keeps the unselected and selected states the same height, so selecting
           a row does not shift the table. -->
      <div class="@container/bulk-toolbar flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-2">
        <span v-if="selectedCount > 0" class="hidden text-sm whitespace-nowrap @4xl/bulk-toolbar:inline">
          {{ $t('transactions.bulkEdit.selectedCount', { count: selectedCount }) }}
        </span>
        <span v-else class="text-muted-foreground text-sm">
          {{ $t('transactions.table.hint') }}
        </span>

        <SelectionTotals v-if="selectedCount > 0" :totals="selectedTotals" :selected-count="selectedCount" />

        <!-- Narrow layout: collapse the action buttons to icon-only so they fit
             one row alongside "N selected" + Cancel. The Cancel control is always
             an icon button (X) – the ghost text version reads as a stray label
             rather than a button. -->
        <div v-if="selectedCount > 0" class="flex flex-wrap items-center gap-2">
          <DesktopOnlyTooltip :content="$t('transactions.bulkEdit.editButton')" :disabled="!isMobileMode">
            <Button
              variant="outline"
              :size="isMobileMode ? 'icon-sm' : 'sm'"
              :disabled="isBulkLoading"
              :aria-label="isMobileMode ? $t('transactions.bulkEdit.editButton') : undefined"
              @click="isBulkEditDialogOpen = true"
            >
              <PencilIcon class="size-4" />
              <template v-if="!isMobileMode">
                {{ $t('transactions.bulkEdit.editButton') }}
              </template>
            </Button>
          </DesktopOnlyTooltip>

          <DropdownMenu>
            <!-- Tooltip wraps the trigger (not nested inside) – reka-ui's as-child
                 can't merge a click handler through the tooltip's fragment root. -->
            <DesktopOnlyTooltip
              :content="$t('transactions.transactionGroups.bulkActions.groupButton')"
              :disabled="!isMobileMode"
            >
              <span class="inline-flex">
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="outline"
                    :size="isMobileMode ? 'icon-sm' : 'sm'"
                    :disabled="isBulkLoading"
                    :aria-label="
                      isMobileMode ? $t('transactions.transactionGroups.bulkActions.groupButton') : undefined
                    "
                  >
                    <GroupIcon class="size-4" />
                    <template v-if="!isMobileMode">
                      {{ $t('transactions.transactionGroups.bulkActions.groupButton') }}
                    </template>
                  </Button>
                </DropdownMenuTrigger>
              </span>
            </DesktopOnlyTooltip>
            <DropdownMenuContent align="end" class="min-w-48">
              <DropdownMenuItem :disabled="selectedCount < 2" @select="isCreateGroupDialogOpen = true">
                <PlusIcon class="mr-2 size-4" />
                {{ $t('transactions.transactionGroups.bulkActions.createNewGroup') }}
              </DropdownMenuItem>
              <DropdownMenuItem @select="isAddToGroupDialogOpen = true">
                <ListPlusIcon class="mr-2 size-4" />
                {{ $t('transactions.transactionGroups.bulkActions.addToExistingGroup') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <!-- Disabled-by-external-selection: ResponsiveTooltip so touch users can
               tap the disabled button and read the reason as a popover (a regular
               hover-only tooltip would never surface on mobile). -->
          <ResponsiveTooltip
            v-if="hasExternalSelected"
            content-class-name="max-w-75"
            :content="$t('transactions.bulkDelete.externalTooltip')"
          >
            <span class="inline-flex">
              <Button
                variant="soft-destructive"
                :size="isMobileMode ? 'icon-sm' : 'sm'"
                disabled
                :aria-label="isMobileMode ? $t('transactions.bulkDelete.button') : undefined"
              >
                <Trash2Icon class="size-4" />
                <template v-if="!isMobileMode">
                  {{ $t('transactions.bulkDelete.button') }}
                </template>
              </Button>
            </span>
          </ResponsiveTooltip>
          <DesktopOnlyTooltip v-else :content="$t('transactions.bulkDelete.button')" :disabled="!isMobileMode">
            <Button
              variant="soft-destructive"
              :size="isMobileMode ? 'icon-sm' : 'sm'"
              :disabled="isBulkLoading"
              :aria-label="isMobileMode ? $t('transactions.bulkDelete.button') : undefined"
              @click="isBulkDeleteDialogOpen = true"
            >
              <Trash2Icon class="size-4" />
              <template v-if="!isMobileMode">
                {{ $t('transactions.bulkDelete.button') }}
              </template>
            </Button>
          </DesktopOnlyTooltip>

          <DesktopOnlyTooltip :content="$t('transactions.bulkEdit.cancelSelection')">
            <Button
              variant="ghost"
              size="icon-sm"
              :disabled="isBulkLoading"
              :aria-label="$t('transactions.bulkEdit.cancelSelection')"
              @click="clearSelection"
            >
              <XIcon class="size-4" />
            </Button>
          </DesktopOnlyTooltip>
        </div>
      </div>
    </slot>

    <!-- Empty state -->
    <div
      v-if="isFetched && displayTransactions.length === 0"
      class="flex flex-1 flex-col items-center justify-center gap-3 py-16"
    >
      <div class="bg-muted flex size-12 items-center justify-center rounded-full">
        <SearchXIcon class="text-muted-foreground size-6" />
      </div>
      <p class="text-foreground font-medium">{{ $t('transactions.table.emptyTitle') }}</p>
      <p class="text-muted-foreground text-sm">{{ $t('transactions.table.emptyDescription') }}</p>
      <Button variant="outline" size="sm" @click="emit('reset-filters')">
        {{ $t('transactions.filters.reset') }}
      </Button>
    </div>

    <!-- overscroll-none disables the rubber-band bounce and scroll chaining past the table's edges -->
    <ScrollArea
      v-else
      ref="scrollAreaRef"
      class="min-h-0 flex-1"
      viewport-class="overscroll-none"
      with-horizontal-scrollbar
    >
      <!-- table-fixed: column widths come from the header only, so rows mounted
           mid-scroll by the virtualizer can never widen the table (which used to
           create transient horizontal overflow). min-width preserves the
           horizontal-scroll fallback when columns genuinely don't fit. -->
      <table
        class="w-full table-fixed border-separate border-spacing-0"
        :style="{ minWidth: `${tableMinWidthPx}px` }"
        :data-always-show-locked-cells="alwaysShowLockedCells || undefined"
      >
        <thead class="sticky top-0 z-2">
          <tr class="text-muted-foreground divide-x text-xs font-medium tracking-wider uppercase">
            <th class="bg-muted sticky left-0 z-1 w-8 border-b">
              <label class="flex size-full items-center justify-center">
                <Checkbox :model-value="selectAllState" @update:model-value="handleSelectAllToggle" />
              </label>
            </th>
            <th
              v-for="column in visibleColumns"
              :key="column.id"
              :class="[
                'bg-muted overflow-hidden border-b px-3 py-2 whitespace-nowrap',
                column.align === 'right' ? 'text-right' : 'text-left',
              ]"
              :style="{ width: `${column.widthPx}px` }"
            >
              <component
                :is="column.sortField ? 'button' : 'span'"
                :class="[
                  'inline-flex max-w-full items-center gap-1',
                  column.sortField && 'hover:text-foreground cursor-pointer transition-colors',
                  column.align === 'right' && 'justify-end',
                ]"
                v-on="column.sortField ? { click: () => onHeaderClick(column) } : {}"
              >
                <span class="truncate">{{ $t(column.labelKey) }}</span>
                <template v-if="column.sortField && sorting.sortBy === column.sortField">
                  <ArrowUpIcon v-if="sorting.order === SORT_DIRECTIONS.asc" class="size-3 shrink-0" />
                  <ArrowDownIcon v-else class="size-3 shrink-0" />
                </template>
              </component>
            </th>
            <th class="bg-muted sticky right-0 z-1 border-b" :style="{ width: `${DETAILS_COLUMN_WIDTH_PX}px` }" />
          </tr>
        </thead>

        <tbody>
          <tr v-if="paddingTop > 0" aria-hidden="true">
            <td :colspan="columnCount" :style="{ height: `${paddingTop}px` }" class="p-0" />
          </tr>

          <template v-for="virtualRow in virtualRows" :key="rowKey(virtualRow.index)">
            <TransactionTableRow
              v-if="displayTransactions[virtualRow.index]"
              :tx="displayTransactions[virtualRow.index]!"
              :visible-columns="visibleColumns"
              :index="virtualRow.index"
              :is-selected="isTransactionSelected(displayTransactions[virtualRow.index]!.id)"
              :is-selectable="isTransactionSelectable(displayTransactions[virtualRow.index]!)"
              :unselectable-reason="getUnselectableReason(displayTransactions[virtualRow.index]!)"
              :payee="payeeById.get(displayTransactions[virtualRow.index]!.payeeId ?? '')"
              :cell-states="cellStates"
              :editing-column="
                editTarget?.tx.id === displayTransactions[virtualRow.index]!.id ? editTarget.column : null
              "
              @record-click="
                editTarget = null;
                handleRecordClick($event);
              "
              @selection-change="
                editTarget = null;
                toggleTransaction($event);
              "
              @cell-click="openCellEditor"
            />
            <TableLoaderRow v-else :columns="visibleColumns" />
          </template>

          <TableLoaderRow
            v-for="index in initialSkeletonRowCount"
            :key="`initial-skeleton-${index}`"
            :columns="visibleColumns"
          />

          <tr v-if="paddingBottom > 0" aria-hidden="true">
            <td :colspan="columnCount" :style="{ height: `${paddingBottom}px` }" class="p-0" />
          </tr>
        </tbody>
      </table>

      <div
        v-if="!hasNextPage && displayTransactions.length > 0"
        class="text-muted-foreground flex h-10 items-center justify-center text-sm"
      >
        {{ $t('transactions.list.noMoreData') }}
      </div>
    </ScrollArea>

    <InlineCellEditor
      v-if="editTarget"
      :key="inlineCellKey({ txId: editTarget.tx.id, column: editTarget.column })"
      :tx="editTarget.tx"
      :column="editTarget.column"
      :label="editTarget.label"
      :mode="editTarget.mode"
      :anchor="editTarget.anchor"
      @close="closeCellEditor"
      @save="saveCellEdit"
      @open-details="openDetailsFromEditor"
    />

    <BulkActionDialogs :actions="bulkActions" />

    <TransactionDetailsModal v-model:open="isDialogVisible" :mobile="isMobileMode" :is-compact="isCompactDialog">
      <ManageTransactionDialogContent v-bind="dialogProps" @close-modal="closeDialog" />
    </TransactionDetailsModal>

    <LoanPaymentDialog
      v-if="loanDialogProps.loanAccount"
      :open="isLoanDialogVisible"
      :loan-account="loanDialogProps.loanAccount"
      :transaction="loanDialogProps.transaction"
      :opposite-transaction="loanDialogProps.oppositeTransaction"
      @update:open="(value) => !value && closeLoanDialog()"
    />
  </div>
</template>

<script lang="ts" setup>
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import { Button } from '@/components/lib/ui/button';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import BulkActionDialogs from '@/components/transactions-list/bulk-action-dialogs.vue';
import SelectionTotals from '@/components/transactions-list/selection-totals.vue';
import TransactionDetailsModal from '@/components/transactions-list/transaction-details-modal.vue';
import { useManageTransactionDialog } from '@/components/transactions-list/use-manage-transaction-dialog';
import { useTransactionsDisplay } from '@/components/transactions-list/use-transactions-display';
import { usePayeeLookup } from '@/composable/data-queries/payees';
import { useBulkTransactionActions } from '@/composable/use-bulk-transaction-actions';
import { SORT_DIRECTIONS, TRANSACTION_SORT_FIELD, TransactionModel } from '@bt/shared/types';
import type { UpdateTransactionBody } from '@bt/shared/types/endpoints';
import { useVirtualizer } from '@tanstack/vue-virtual';
import { useElementSize, useEventListener } from '@vueuse/core';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  GroupIcon,
  ListPlusIcon,
  PencilIcon,
  PlusIcon,
  SearchXIcon,
  Trash2Icon,
  XIcon,
} from '@lucide/vue';
import type { ReferenceElement } from 'reka-ui';
import { type ComputedRef, computed, defineAsyncComponent, nextTick, ref, watch, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';

import type { ColumnDefinition, TableSorting } from './columns';
import InlineCellEditor from './inline-cell-editor.vue';
import type { ClaimedCellMode, InlineEditableColumn } from './inline-cell-mode';
import TableLoaderRow from './table-loader-row.vue';
import TransactionTableRow from './transaction-table-row.vue';
import { inlineCellKey, useInlineTransactionEdit } from './use-inline-transaction-edit';

const ROW_HEIGHT_PX = 40;
const CHECKBOX_COLUMN_WIDTH_PX = 32;
const DETAILS_COLUMN_WIDTH_PX = 40;

const ManageTransactionDialogContent = defineAsyncComponent(
  () => import('@/components/dialogs/manage-transaction/dialog-content.vue'),
);
const LoanPaymentDialog = defineAsyncComponent(() => import('@/pages/loans/components/loan-payment-dialog/index.vue'));

const props = defineProps<{
  transactions: TransactionModel[];
  visibleColumns: ColumnDefinition[];
  sorting: TableSorting;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetched: boolean;
  /**
   * Container-based narrow-layout flag from the page (the sidebar makes viewport
   * breakpoints unreliable here) — drives Drawer-vs-Dialog for the detail panel.
   */
  isMobileMode: boolean;
  selectionScopeKey?: string;
  alwaysShowLockedCells?: boolean;
}>();

const emit = defineEmits<{
  'fetch-next-page': [];
  'update:sorting': [value: TableSorting];
  'reset-filters': [];
}>();

const tableMinWidthPx = computed(
  () =>
    CHECKBOX_COLUMN_WIDTH_PX +
    DETAILS_COLUMN_WIDTH_PX +
    props.visibleColumns.reduce((sum, column) => sum + column.widthPx, 0),
);

// Table view always flattens groups (one row per record); passing
// contentFiltersActive=true gives transfer dedup without group rows, so the
// display list never contains GroupRowData entries.
const { displayTransactions } = useTransactionsDisplay({
  transactions: () => props.transactions,
  contentFiltersActive: () => true,
}) as { displayTransactions: ComputedRef<TransactionModel[]> };

// Checkbox and details columns on top of the configurable ones.
const columnCount = computed(() => props.visibleColumns.length + 2);

// Payee name + logo: transactions carry only payeeId; resolve from the full
// payee lookup so any payee resolves, not just the truncated top-50 dropdown list.
const { byId: payeeById } = usePayeeLookup();

// Transaction detail dialog; transfer_to_loan rows route to the loan dialog instead
const {
  isDialogVisible,
  dialogProps,
  isCompactDialog,
  handleRecordClick,
  closeDialog,
  isLoanDialogVisible,
  loanDialogProps,
  closeLoanDialog,
} = useManageTransactionDialog();

// Selection, eligibility, bulk mutations and dialog state — shared with the list view.
const bulkActions = useBulkTransactionActions({
  getTransactions: () => displayTransactions.value,
  getScopeKey: () => props.selectionScopeKey,
});
const {
  selectedCount,
  getSelectedTransactionIds,
  isTransactionSelectable,
  isTransactionSelected,
  toggleTransaction,
  clearSelection,
  getUnselectableReason,
  hasExternalSelected,
  selectedTotals,
  selectAllState,
  handleSelectAllToggle,
  isBulkEditDialogOpen,
  isCreateGroupDialogOpen,
  isAddToGroupDialogOpen,
  isBulkDeleteDialogOpen,
  isBulkLoading,
} = bulkActions;

// Sorting: click cycles asc → desc; switching column starts at asc; Date is the
// default sort so its cycle is desc → asc (matches the list default).
const onHeaderClick = (column: ColumnDefinition) => {
  if (!column.sortField) return;

  if (props.sorting.sortBy !== column.sortField) {
    const initialOrder = column.sortField === TRANSACTION_SORT_FIELD.time ? SORT_DIRECTIONS.desc : SORT_DIRECTIONS.asc;
    emit('update:sorting', { sortBy: column.sortField, order: initialOrder });
    return;
  }

  emit('update:sorting', {
    sortBy: column.sortField,
    order: props.sorting.order === SORT_DIRECTIONS.asc ? SORT_DIRECTIONS.desc : SORT_DIRECTIONS.asc,
  });
};

// Virtualization (fixed 40px rows, padding-row technique for <table>)
const scrollAreaRef = ref<InstanceType<typeof ScrollArea> | null>(null);
const getScrollElement = () => scrollAreaRef.value?.viewportRef?.viewportElement ?? null;

// The virtualizer has nothing to render before the first fetch resolves, which
// would leave a bare header row over empty space; skeleton rows fill the viewport instead.
const { height: viewportHeight } = useElementSize(() => getScrollElement());
const initialSkeletonRowCount = computed(() =>
  !props.isFetched && displayTransactions.value.length === 0 ? Math.ceil(viewportHeight.value / ROW_HEIGHT_PX) : 0,
);

const virtualizer = useVirtualizer(
  computed(() => ({
    count: displayTransactions.value.length + (props.hasNextPage ? 1 : 0),
    getScrollElement,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 15,
  })),
);

const virtualRows = computed(() => virtualizer.value.getVirtualItems());
const totalSize = computed(() => virtualizer.value.getTotalSize());

const paddingTop = computed(() => (virtualRows.value.length > 0 ? virtualRows.value[0]!.start : 0));
const paddingBottom = computed(() =>
  virtualRows.value.length > 0 ? totalSize.value - virtualRows.value[virtualRows.value.length - 1]!.end : 0,
);

// One editor for the whole table, anchored by lookup: saves change updatedAt, which remounts the row's cells.
const { t } = useI18n();
const { cellStates, save } = useInlineTransactionEdit();

const editTarget = ref<{
  tx: TransactionModel;
  oppositeTx: TransactionModel | undefined;
  column: InlineEditableColumn;
  label: string;
  mode: ClaimedCellMode;
  anchor: ReferenceElement;
} | null>(null);

const findCell = ({ key }: { key: string }) => document.querySelector<HTMLElement>(`[data-inline-cell="${key}"]`);

const cellAnchor = ({ key }: { key: string }): ReferenceElement => {
  let lastRect = new DOMRect();
  return {
    getBoundingClientRect: () => {
      lastRect = findCell({ key })?.getBoundingClientRect() ?? lastRect;
      return lastRect;
    },
  };
};

// preventScroll: scrolling the table closes the editor.
const refocusCell = ({ key }: { key: string }) =>
  nextTick(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    findCell({ key })?.focus({ preventScroll: true });
  });

const closeCellEditor = () => {
  if (!editTarget.value) return;
  const { tx, column } = editTarget.value;
  editTarget.value = null;
  refocusCell({ key: inlineCellKey({ txId: tx.id, column }) });
};

const openCellEditor = ({
  tx,
  oppositeTx,
  column,
  mode,
}: {
  tx: TransactionModel;
  oppositeTx: TransactionModel | undefined;
  column: InlineEditableColumn;
  mode: ClaimedCellMode;
}) => {
  if (editTarget.value?.tx.id === tx.id && editTarget.value.column === column) {
    closeCellEditor();
    return;
  }
  const labelKey = props.visibleColumns.find((item) => item.id === column)?.labelKey;
  editTarget.value = {
    tx,
    oppositeTx,
    column,
    label: labelKey ? t(labelKey) : '',
    mode,
    anchor: cellAnchor({ key: inlineCellKey({ txId: tx.id, column }) }),
  };
};

const saveCellEdit = async (body: UpdateTransactionBody) => {
  if (!editTarget.value) return;
  const { tx, column, label } = editTarget.value;
  const key = inlineCellKey({ txId: tx.id, column });
  closeCellEditor();
  const currentTx = displayTransactions.value.find((item) => item.id === tx.id) ?? tx;
  await save({ tx: currentTx, column, columnLabel: label, body });
  // The refetch remounts the row, which drops focus.
  refocusCell({ key });
};

const openDetailsFromEditor = () => {
  if (!editTarget.value) return;
  const { tx, oppositeTx } = editTarget.value;
  editTarget.value = null;
  handleRecordClick([tx, oppositeTx]);
};

// Discards the open edit once the table scrolls: the popover isn't pinned to a row that may virtualize away.
useEventListener(getScrollElement, 'scroll', () => (editTarget.value = null), { passive: true });

watch(displayTransactions, (list) => {
  const editedId = editTarget.value?.tx.id;
  if (editedId && !list.some((item) => item.id === editedId)) editTarget.value = null;
});

const rowKey = (index: number) => {
  const tx = displayTransactions.value[index];
  return tx ? `${tx.id}-${tx.updatedAt}` : `loader-${index}`;
};

// Infinite scroll: request the next page once the loader row becomes visible.
watchEffect(() => {
  const lastItem = virtualRows.value[virtualRows.value.length - 1];
  if (!lastItem) return;

  if (lastItem.index >= displayTransactions.value.length - 1 && props.hasNextPage && !props.isFetchingNextPage) {
    emit('fetch-next-page');
  }
});

defineExpose({
  scrollToTop: () => virtualizer.value.scrollToIndex(0),
});
</script>
