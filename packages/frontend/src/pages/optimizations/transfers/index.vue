<script setup lang="ts">
import { bulkScanTransferRecommendations, dismissTransferSuggestion, linkTransactions } from '@/api/transactions';
import * as Dialog from '@/components/lib/ui/dialog';
import * as Drawer from '@/components/lib/ui/drawer';
import DocsLink from '@/components/common/docs-link.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Card } from '@/components/lib/ui/card';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { useNotificationCenter } from '@/components/notification-center';
import { useManageTransactionDialog } from '@/components/transactions-list/use-manage-transaction-dialog';
import { cn } from '@/lib/utils';
import { VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const/vue-query';
import { useWindowBreakpoints } from '@/composable/window-breakpoints';
import { useVirtualizedInfiniteScroll } from '@/composable/virtualized-infinite-scroll';
import type { TransactionModel, RecordId, BulkTransferScanItem } from '@bt/shared/types';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import type { Period } from '@/composable/use-period-navigation';
import { endOfMonth, startOfMonth, subMonths } from 'date-fns';
import { SearchXIcon, SparklesIcon } from '@lucide/vue';
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { createReusableTemplate } from '@vueuse/core';

import ExpenseListItem from './components/expense-list-item.vue';
import ScanControls from './components/scan-controls.vue';
import SuggestionsPanel from './components/suggestions-panel.vue';
import DialogHeader from '@/components/lib/ui/dialog/DialogHeader.vue';

const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const queryClient = useQueryClient();
const SINGLE_PANEL_BREAKPOINT = 1023;
const isSinglePanel = useWindowBreakpoints(SINGLE_PANEL_BREAKPOINT);

const ManageTransactionDialogContent = defineAsyncComponent(
  () => import('@/components/dialogs/manage-transaction/dialog-content.vue'),
);
const LoanPaymentDialog = defineAsyncComponent(() => import('@/pages/loans/components/loan-payment-dialog/index.vue'));

const [UseDialogTemplate, SlotContent] = createReusableTemplate();

const PAGE_SIZE = 20;

const period = ref<Period>({
  from: startOfMonth(subMonths(new Date(), 2)),
  to: endOfMonth(new Date()),
});
const includeOutOfWallet = ref(false);

// Accumulated scan results across pages
const allItems = ref<BulkTransferScanItem[]>([]);
const totalCount = ref(0);
const currentOffset = ref(0);
const isFetchingPage = ref(false);

const selectedItemIndex = ref<number>(0);
const suggestionsDialogOpen = ref(false);

const selectedItem = computed<BulkTransferScanItem | null>(() => {
  if (allItems.value.length === 0) return null;
  return allItems.value[selectedItemIndex.value] ?? null;
});

const hasScanned = ref(false);
const hasNextPage = computed(() => allItems.value.length < totalCount.value);

// Manage transaction dialog
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

// Re-scan when either edit dialog closes (user may have edited amount/date)
watch([isDialogVisible, isLoanDialogVisible], ([visible, loanVisible]) => {
  if (!visible && !loanVisible && hasScanned.value) {
    freshScan();
  }
});

// Virtual scroll for left panel
const leftScrollAreaRef = ref<InstanceType<typeof ScrollArea> | null>(null);
const leftPanelScrollElement = computed<HTMLElement | null>(
  () => (leftScrollAreaRef.value?.viewportRef as { viewportElement?: HTMLElement } | null)?.viewportElement ?? null,
);

const { virtualRows, totalSize } = useVirtualizedInfiniteScroll<BulkTransferScanItem>({
  items: allItems,
  hasNextPage,
  fetchNextPage: loadNextPage,
  isFetchingNextPage: isFetchingPage,
  parentRef: leftPanelScrollElement,
  estimateSize: () => 52,
  overscan: 10,
  getItemKey: (index) => allItems.value[index]?.expense.id ?? index,
});

async function loadNextPage() {
  if (isFetchingPage.value) return;
  isFetchingPage.value = true;

  try {
    const data = await bulkScanTransferRecommendations({
      from: period.value.from.toISOString(),
      to: period.value.to.toISOString(),
      includeOutOfWallet: includeOutOfWallet.value,
      offset: currentOffset.value,
      limit: PAGE_SIZE,
    });

    allItems.value = [...allItems.value, ...data.items];
    totalCount.value = data.total;
    currentOffset.value = allItems.value.length;
  } catch {
    addErrorNotification(t('optimizations.transferSuggestions.notifications.loadError'));
  } finally {
    isFetchingPage.value = false;
  }
}

// Fresh scan (resets pagination)
const isScanning = ref(false);

async function freshScan() {
  if (isScanning.value) return;
  isScanning.value = true;

  try {
    const data = await bulkScanTransferRecommendations({
      from: period.value.from.toISOString(),
      to: period.value.to.toISOString(),
      includeOutOfWallet: includeOutOfWallet.value,
      offset: 0,
      limit: PAGE_SIZE,
    });

    allItems.value = data.items;
    totalCount.value = data.total;
    currentOffset.value = data.items.length;
    selectedItemIndex.value = 0;
    hasScanned.value = true;
  } catch {
    addErrorNotification(t('optimizations.transferSuggestions.notifications.scanError'));
  } finally {
    isScanning.value = false;
  }
}

// Link mutation
const linkMutation = useMutation({
  mutationFn: ({ expenseId, incomeId }: { expenseId: string; incomeId: string }) =>
    linkTransactions({ ids: [[expenseId as RecordId, incomeId as RecordId]] }),
  onMutate: async ({ expenseId, incomeId }) => {
    const previous = { items: [...allItems.value], total: totalCount.value };

    allItems.value = allItems.value
      .filter((item) => item.expense.id !== expenseId)
      .map((item) => ({
        ...item,
        matches: item.matches.filter((m) => m.transaction.id !== incomeId),
      }))
      .filter((item) => item.matches.length > 0);
    totalCount.value = Math.max(0, totalCount.value - 1);
    currentOffset.value = allItems.value.length;

    if (selectedItemIndex.value >= allItems.value.length) {
      selectedItemIndex.value = Math.max(0, allItems.value.length - 1);
    }

    suggestionsDialogOpen.value = false;

    return { previous };
  },
  onSuccess: () => {
    addSuccessNotification(t('optimizations.transferSuggestions.notifications.linkSuccess'));

    // Background re-fetch to recalculate confidence scores
    freshScan();
  },
  onError: (_err, _vars, context) => {
    if (context?.previous) {
      allItems.value = context.previous.items;
      totalCount.value = context.previous.total;
      currentOffset.value = allItems.value.length;
    }
    addErrorNotification(t('optimizations.transferSuggestions.notifications.linkError'));
  },
  onSettled: () => {
    queryClient.invalidateQueries({
      queryKey: [VUE_QUERY_GLOBAL_PREFIXES.transactionChange],
    });
  },
});

// Skip (dismiss) mutation
const skipMutation = useMutation({
  mutationFn: ({ expenseId, incomeId }: { expenseId: string; incomeId: string }) =>
    dismissTransferSuggestion({
      expenseTransactionId: expenseId as RecordId,
      incomeTransactionId: incomeId as RecordId,
    }),
  onMutate: async ({ expenseId, incomeId }) => {
    const previous = { items: [...allItems.value], total: totalCount.value };

    // Optimistic: remove the skipped match from the expense's matches
    allItems.value = allItems.value
      .map((item) => {
        if (item.expense.id !== expenseId) return item;
        return {
          ...item,
          matches: item.matches.filter((m) => m.transaction.id !== incomeId),
        };
      })
      .filter((item) => item.matches.length > 0);

    // If expense lost all matches, decrement total
    if (allItems.value.length < previous.items.length) {
      totalCount.value = Math.max(0, totalCount.value - 1);
    }
    currentOffset.value = allItems.value.length;

    if (selectedItemIndex.value >= allItems.value.length) {
      selectedItemIndex.value = Math.max(0, allItems.value.length - 1);
    }

    return { previous };
  },
  onSuccess: () => {
    addSuccessNotification(t('optimizations.transferSuggestions.notifications.skipSuccess'));
  },
  onError: (_err, _vars, context) => {
    if (context?.previous) {
      allItems.value = context.previous.items;
      totalCount.value = context.previous.total;
      currentOffset.value = allItems.value.length;
    }
    addErrorNotification(t('optimizations.transferSuggestions.notifications.skipError'));
  },
  onSettled: () => {
    queryClient.invalidateQueries({
      queryKey: [VUE_QUERY_GLOBAL_PREFIXES.transactionChange],
    });
  },
});

function handleSelectExpense(index: number) {
  selectedItemIndex.value = index;
  if (isSinglePanel.value) {
    suggestionsDialogOpen.value = true;
  }
}

function handleLink(payload: { expenseId: string; incomeId: string }) {
  linkMutation.mutate(payload);
}

function handleSkip(payload: { expenseId: string; incomeId: string }) {
  skipMutation.mutate(payload);
}

function handleTransactionClick(tx: TransactionModel, oppositeTx: TransactionModel | undefined) {
  handleRecordClick([tx, oppositeTx]);
}
</script>

<template>
  <div
    class="flex h-[calc(100dvh-var(--header-height))] flex-col gap-4 overflow-hidden p-4 max-md:h-[calc(100dvh-var(--header-height)-var(--bottom-navbar-height))] md:p-6"
  >
    <!-- Header -->
    <div class="shrink-0">
      <h1 class="text-2xl font-bold tracking-tight">
        {{ $t('optimizations.title') }}
      </h1>
      <p class="text-muted-foreground mt-1 text-sm">
        {{ $t('optimizations.transferSuggestions.description') }}
        <DocsLink path="/transfers-and-refunds/link-existing-transactions/#find-pairs-with-transfer-matching" />
      </p>
    </div>

    <!-- Scan Controls -->
    <ScanControls
      v-model:period="period"
      v-model:include-out-of-wallet="includeOutOfWallet"
      :is-loading="isScanning"
      class="shrink-0"
      @scan="freshScan()"
    />

    <!-- Count header -->
    <div v-if="hasScanned && totalCount > 0" class="text-muted-foreground shrink-0 text-sm">
      {{ totalCount }} {{ $t('optimizations.transferSuggestions.potentialTransfersFound') }}
    </div>

    <!-- Main container — always rendered, holds either content or empty/initial/loading states -->
    <Card class="flex min-h-0 flex-1 overflow-hidden">
      <template v-if="hasScanned && allItems.length > 0">
        <!-- Left panel: virtualized expense list -->
        <ScrollArea ref="leftScrollAreaRef" class="w-full shrink-0 lg:w-80 lg:border-r">
          <div :style="{ height: `${totalSize}px`, width: '100%', position: 'relative' }">
            <div
              v-for="virtualRow in virtualRows"
              :key="String(virtualRow.key)"
              :style="{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }"
            >
              <template v-if="virtualRow.index < allItems.length">
                <div class="px-2 py-0.5">
                  <ExpenseListItem
                    :item="allItems[virtualRow.index]!"
                    :is-selected="selectedItemIndex === virtualRow.index"
                    @select="handleSelectExpense(virtualRow.index)"
                  />
                </div>
              </template>
              <template v-else>
                <div class="text-muted-foreground flex items-center justify-center py-3 text-xs">
                  {{ $t('optimizations.transferSuggestions.scanning') }}
                </div>
              </template>
            </div>
          </div>
        </ScrollArea>

        <!-- Right panel: suggestions (desktop) -->
        <div class="hidden min-w-0 flex-1 overflow-hidden lg:flex">
          <SuggestionsPanel
            :selected-item="selectedItem"
            :is-linking="linkMutation.isPending.value"
            :is-skipping="skipMutation.isPending.value"
            @link="handleLink"
            @skip="handleSkip"
            @record-click="handleTransactionClick"
          />
        </div>
      </template>

      <!-- Empty state (after scan, no results) -->
      <div
        v-else-if="hasScanned && allItems.length === 0 && !isScanning"
        class="flex flex-1 flex-col items-center justify-center gap-3 px-6"
      >
        <SearchXIcon class="text-muted-foreground size-12" />
        <div class="text-center">
          <p class="font-medium">{{ $t('optimizations.transferSuggestions.empty.title') }}</p>
          <p class="text-muted-foreground mt-1 text-sm">
            {{ $t('optimizations.transferSuggestions.empty.description') }}
          </p>
        </div>
      </div>

      <!-- Initial state (before first scan) -->
      <div v-else-if="!hasScanned && !isScanning" class="flex flex-1 flex-col items-center justify-center gap-3 px-6">
        <SparklesIcon class="text-muted-foreground size-12" />
        <div class="text-center">
          <p class="font-medium">{{ $t('optimizations.transferSuggestions.initial.title') }}</p>
          <p class="text-muted-foreground mt-1 max-w-md text-sm">
            {{ $t('optimizations.transferSuggestions.initial.description') }}
          </p>
        </div>
      </div>

      <!-- Loading state -->
      <div v-else-if="isScanning && allItems.length === 0" class="flex flex-1 items-center justify-center">
        <div class="flex flex-col items-center gap-3">
          <div class="bg-primary/30 size-8 animate-ping rounded-full" />
          <p class="text-muted-foreground text-sm">{{ $t('optimizations.transferSuggestions.scanning') }}</p>
        </div>
      </div>
    </Card>

    <!-- Single-panel: suggestions in a dialog/drawer -->
    <ResponsiveDialog
      v-if="isSinglePanel"
      v-model:open="suggestionsDialogOpen"
      no-internal-scroll
      dialog-content-class="max-w-2xl max-h-[85vh] px-0 pb-0 overflow-hidden"
      drawer-content-class="max-h-[85vh] !px-0 !pb-0"
    >
      <template #title>
        <div class="px-4">
          {{ $t('optimizations.transferSuggestions.suggestionsFor') }}
        </div>
      </template>
      <SuggestionsPanel
        :selected-item="selectedItem"
        :is-linking="linkMutation.isPending.value"
        :is-skipping="skipMutation.isPending.value"
        @link="handleLink"
        @skip="handleSkip"
        @record-click="handleTransactionClick"
      />
    </ResponsiveDialog>

    <!-- Manage transaction dialog -->
    <UseDialogTemplate>
      <ManageTransactionDialogContent v-bind="dialogProps" @close-modal="closeDialog" />
    </UseDialogTemplate>

    <template v-if="isSinglePanel">
      <Drawer.Drawer v-model:open="isDialogVisible">
        <Drawer.DrawerContent custom-indicator>
          <Drawer.DrawerTitle class="sr-only">{{ $t('transactions.list.detailsTitle') }}</Drawer.DrawerTitle>
          <Drawer.DrawerDescription class="sr-only">{{
            $t('transactions.list.detailsDescription')
          }}</Drawer.DrawerDescription>
          <SlotContent />
        </Drawer.DrawerContent>
      </Drawer.Drawer>
    </template>
    <template v-else>
      <Dialog.Dialog v-model:open="isDialogVisible">
        <Dialog.DialogContent
          custom-close
          :class="cn('max-h-[90dvh] w-full overflow-hidden p-0', isCompactDialog ? 'max-w-lg' : 'max-w-225')"
        >
          <Dialog.DialogTitle class="sr-only">{{ $t('transactions.list.detailsTitle') }}</Dialog.DialogTitle>
          <Dialog.DialogDescription class="sr-only">{{
            $t('transactions.list.detailsDescription')
          }}</Dialog.DialogDescription>
          <SlotContent />
        </Dialog.DialogContent>
      </Dialog.Dialog>
    </template>

    <!-- Dedicated loan-payment dialog: handleRecordClick routes transfer_to_loan rows here. -->
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
