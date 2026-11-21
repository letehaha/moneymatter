<script setup lang="ts">
import ColumnConfigPopover from '@/components/common/column-config-popover.vue';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import DeleteInvestmentTransactionDialog from '@/components/dialogs/delete-investment-transaction-dialog.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useVirtualizedInfiniteScroll } from '@/composable/virtualized-infinite-scroll';
import { useFormatCurrency } from '@/composable/formatters';
import { toLocalNumber } from '@/js/helpers';
import type { InvestmentTransactionModel } from '@bt/shared/types';
import { ASSET_CLASS, INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types/investments';
import { format } from 'date-fns';
import { PlusIcon, Trash2Icon } from '@lucide/vue';
import { computed, ref, toRef } from 'vue';

import { INVESTMENT_TX_COLUMN } from './columns';
import { useInvestmentTxTableColumns } from './use-investment-tx-table-columns';

const props = defineProps<{
  transactions: InvestmentTransactionModel[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
}>();

defineEmits<{ (e: 'add-transaction'): void }>();

const { formatAmountByCurrencyCode, formatBaseCurrency } = useFormatCurrency();
const formatDate = (date: string | Date) => format(new Date(date), 'dd/MM/yyyy');
const formatTransactionDate = (date: string | Date) => format(new Date(date), 'dd/MM/yyyy HH:mm');
const formatRate = (rate: string) => toLocalNumber(rate, { minimumFractionDigits: 4, maximumFractionDigits: 4 });

const formatQuantity = (quantity: string | null, assetClass: ASSET_CLASS | undefined) => {
  if (quantity == null) return '';
  const isCrypto = assetClass === ASSET_CLASS.crypto;
  return toLocalNumber(quantity, {
    minimumFractionDigits: isCrypto ? 0 : 2,
    maximumFractionDigits: isCrypto ? 5 : 2,
  });
};

const getCategoryClasses = (category: INVESTMENT_TRANSACTION_CATEGORY) => {
  const map: Record<INVESTMENT_TRANSACTION_CATEGORY, string> = {
    [INVESTMENT_TRANSACTION_CATEGORY.buy]: 'bg-green-500/10 text-green-600',
    [INVESTMENT_TRANSACTION_CATEGORY.sell]: 'bg-red-500/10 text-red-600',
    [INVESTMENT_TRANSACTION_CATEGORY.dividend]: 'bg-blue-500/10 text-blue-600',
    [INVESTMENT_TRANSACTION_CATEGORY.transfer]: 'bg-amber-500/10 text-amber-600',
    [INVESTMENT_TRANSACTION_CATEGORY.tax]: 'bg-slate-500/10 text-slate-600',
    [INVESTMENT_TRANSACTION_CATEGORY.fee]: 'bg-orange-500/10 text-orange-600',
    [INVESTMENT_TRANSACTION_CATEGORY.cancel]: 'bg-gray-500/10 text-gray-600',
    [INVESTMENT_TRANSACTION_CATEGORY.other]: 'bg-slate-500/10 text-slate-600',
  };
  return map[category] ?? 'bg-slate-500/10 text-slate-600';
};

const { visibleColumns, configurableColumns, toggleColumn, reorderColumns, resetToDefaults } =
  useInvestmentTxTableColumns();

// Visible column tracks + fixed trailing track for the delete button.
const gridTemplate = computed(() => visibleColumns.value.map((column) => column.gridSize).join(' ') + ' 2.25rem');

// Mirrored from template classes: gap-2, px-3, delete-button track.
const TRACK_GAP_REM = 0.5;
const ROW_PADDING_X_REM = 1.5;
const ACTIONS_TRACK_REM = 2.25;

// Wrapper min-width = sum of track mins, so header bg and row hover span the
// full scrollable width instead of stopping at the visible width.
const gridMinWidth = computed(() => {
  const tracksRem = visibleColumns.value.reduce((sum, column) => sum + column.minRem, 0) + ACTIONS_TRACK_REM;
  // n+1 tracks (columns + actions) → n gaps
  const gapsRem = visibleColumns.value.length * TRACK_GAP_REM;
  return `${tracksRem + gapsRem + ROW_PADDING_X_REM}rem`;
});

const itemsRef = computed(() => props.transactions);
const hasNextPageRef = toRef(() => props.hasNextPage);
const isFetchingNextPageRef = toRef(() => props.isFetchingNextPage);

// The ScrollArea viewport owns both scroll axes, so it is also the
// virtualizer's scroll element (same pattern as transactions-table.vue).
const scrollAreaRef = ref<InstanceType<typeof ScrollArea> | null>(null);
const parentRef = computed<HTMLElement | null>(() => scrollAreaRef.value?.viewportRef?.viewportElement ?? null);

const { virtualRows, totalSize } = useVirtualizedInfiniteScroll<InvestmentTransactionModel>({
  items: itemsRef,
  hasNextPage: hasNextPageRef,
  isFetchingNextPage: isFetchingNextPageRef,
  fetchNextPage: async () => props.fetchNextPage(),
  parentRef,
  // py-1.5 + size-7 delete button; underestimating leaves a permanent few-px vertical scroll.
  estimateSize: () => 40,
  overscan: 8,
  getItemKey: (index) => itemsRef.value[index]?.id ?? index,
});
</script>

<template>
  <div class="p-4">
    <div class="mb-3 flex items-center justify-between">
      <h4 class="text-sm font-semibold">{{ $t('portfolioDetail.transactionsList.title') }}</h4>
      <div class="flex items-center gap-1">
        <UiButton variant="outline" size="sm" @click="$emit('add-transaction')">
          <PlusIcon class="size-3.5" />
          {{ $t('portfolioDetail.transactionsList.addButton') }}
        </UiButton>
        <ColumnConfigPopover
          :configurable-columns="configurableColumns"
          @toggle="toggleColumn"
          @reorder="reorderColumns"
          @reset="resetToDefaults"
        />
      </div>
    </div>

    <!-- minmax(<min>, 1fr) tracks: columns collapse to their mins first;
         horizontal scroll kicks in once even the mins don't fit.
         overscroll-none disables rubber-band bounce / scroll chaining past the list's edges. -->
    <ScrollArea
      ref="scrollAreaRef"
      data-testid="investment-transactions-scroll-area"
      class="rounded-md border"
      viewport-class="max-h-[min(60vh,540px)] overscroll-none"
      with-horizontal-scrollbar
    >
      <!-- pb-2.5 keeps the overlay horizontal scrollbar off the last row. -->
      <div class="pb-2.5" :style="{ minWidth: gridMinWidth }">
        <!-- Header lives inside the scrolling viewport so it scrolls horizontally
             with the columns; sticky keeps it pinned during vertical scroll. -->
        <div
          class="bg-muted border-border text-muted-foreground sticky top-0 z-10 border-b text-xs font-medium tracking-wider uppercase"
        >
          <div class="grid items-center gap-2 px-3 py-2" :style="{ gridTemplateColumns: gridTemplate }">
            <div
              v-for="column in visibleColumns"
              :key="column.id"
              :class="column.align === 'right' ? 'text-right' : 'text-left'"
            >
              <ResponsiveTooltip
                v-if="column.tooltipKey"
                :content="$t(column.tooltipKey)"
                content-class-name="max-w-60 whitespace-normal"
              >
                <span class="cursor-help underline decoration-dotted underline-offset-2">
                  {{ $t(column.labelKey) }}
                </span>
              </ResponsiveTooltip>
              <template v-else>{{ $t(column.labelKey) }}</template>
            </div>
            <div></div>
          </div>
        </div>

        <div class="divide-border relative divide-y text-sm">
          <div :style="{ height: `${totalSize}px`, position: 'relative', width: '100%' }">
            <div
              v-for="virtualRow in virtualRows"
              :key="String(virtualRow.key)"
              class="absolute top-0 left-0 w-full"
              :style="{ transform: `translateY(${virtualRow.start}px)` }"
            >
              <template v-if="transactions[virtualRow.index]">
                <div
                  class="hover:bg-hover grid items-center gap-2 px-3 py-1.5 transition-colors"
                  :style="{ gridTemplateColumns: gridTemplate }"
                >
                  <template v-for="column in visibleColumns" :key="column.id">
                    <div v-if="column.id === INVESTMENT_TX_COLUMN.date" class="tabular-nums">
                      <ResponsiveTooltip :content="formatTransactionDate(transactions[virtualRow.index]!.date)">
                        <span class="cursor-help underline decoration-dotted underline-offset-2">
                          {{ formatDate(transactions[virtualRow.index]!.date) }}
                        </span>
                      </ResponsiveTooltip>
                    </div>
                    <div v-else-if="column.id === INVESTMENT_TX_COLUMN.type">
                      <span
                        :class="getCategoryClasses(transactions[virtualRow.index]!.category)"
                        class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize"
                      >
                        {{
                          $t(`portfolioDetail.transactionsList.categories.${transactions[virtualRow.index]!.category}`)
                        }}
                      </span>
                    </div>
                    <div v-else-if="column.id === INVESTMENT_TX_COLUMN.quantity" class="text-right tabular-nums">
                      {{
                        formatQuantity(
                          transactions[virtualRow.index]!.quantity,
                          transactions[virtualRow.index]!.security?.assetClass,
                        )
                      }}
                    </div>
                    <div v-else-if="column.id === INVESTMENT_TX_COLUMN.price" class="text-right tabular-nums">
                      {{
                        formatAmountByCurrencyCode({
                          amount: parseFloat(transactions[virtualRow.index]!.price as string),
                          currencyCode: transactions[virtualRow.index]!.security!.currencyCode,
                        })
                      }}
                    </div>
                    <div v-else-if="column.id === INVESTMENT_TX_COLUMN.fees" class="text-right tabular-nums">
                      {{
                        formatAmountByCurrencyCode({
                          amount: parseFloat(transactions[virtualRow.index]!.fees as string),
                          currencyCode: transactions[virtualRow.index]!.security!.currencyCode,
                        })
                      }}
                    </div>
                    <div
                      v-else-if="column.id === INVESTMENT_TX_COLUMN.amount"
                      class="text-right font-medium tabular-nums"
                    >
                      {{
                        formatAmountByCurrencyCode({
                          amount: parseFloat(transactions[virtualRow.index]!.amount as string),
                          currencyCode: transactions[virtualRow.index]!.security!.currencyCode,
                        })
                      }}
                    </div>
                    <div v-else-if="column.id === INVESTMENT_TX_COLUMN.note" class="min-w-0">
                      <ResponsiveTooltip
                        v-if="transactions[virtualRow.index]!.name"
                        :content="transactions[virtualRow.index]!.name!"
                        content-class-name="max-w-[min(400px,100vw)] whitespace-normal break-words"
                      >
                        <span class="text-muted-foreground block cursor-default truncate whitespace-nowrap">
                          {{ transactions[virtualRow.index]!.name }}
                        </span>
                      </ResponsiveTooltip>
                    </div>
                    <div v-else-if="column.id === INVESTMENT_TX_COLUMN.refAmount" class="text-right tabular-nums">
                      {{ formatBaseCurrency(parseFloat(transactions[virtualRow.index]!.refAmount)) }}
                    </div>
                    <div v-else-if="column.id === INVESTMENT_TX_COLUMN.refFees" class="text-right tabular-nums">
                      {{ formatBaseCurrency(parseFloat(transactions[virtualRow.index]!.refFees)) }}
                    </div>
                    <div
                      v-else-if="column.id === INVESTMENT_TX_COLUMN.settlementAmount"
                      class="text-right tabular-nums"
                    >
                      {{
                        formatAmountByCurrencyCode({
                          amount: parseFloat(transactions[virtualRow.index]!.settlementAmount),
                          currencyCode: transactions[virtualRow.index]!.settlementCurrencyCode,
                        })
                      }}
                    </div>
                    <div v-else-if="column.id === INVESTMENT_TX_COLUMN.settlementCurrency" class="text-left">
                      {{ transactions[virtualRow.index]!.settlementCurrencyCode }}
                    </div>
                    <div v-else-if="column.id === INVESTMENT_TX_COLUMN.settlementFees" class="text-right tabular-nums">
                      {{
                        formatAmountByCurrencyCode({
                          amount: parseFloat(transactions[virtualRow.index]!.settlementFees),
                          currencyCode: transactions[virtualRow.index]!.settlementCurrencyCode,
                        })
                      }}
                    </div>
                    <div v-else-if="column.id === INVESTMENT_TX_COLUMN.settlementRate" class="text-right tabular-nums">
                      {{ formatRate(transactions[virtualRow.index]!.settlementRate) }}
                    </div>
                    <div v-else-if="column.id === INVESTMENT_TX_COLUMN.createdAt" class="tabular-nums">
                      {{ formatDate(transactions[virtualRow.index]!.createdAt) }}
                    </div>
                  </template>
                  <div class="text-center">
                    <DesktopOnlyTooltip :content="$t('portfolioDetail.transactionsList.deleteTransaction.tooltip')">
                      <span class="inline-flex">
                        <DeleteInvestmentTransactionDialog :transaction-id="transactions[virtualRow.index]!.id">
                          <UiButton
                            variant="ghost-destructive"
                            size="icon"
                            class="size-7"
                            :aria-label="$t('portfolioDetail.transactionsList.deleteTransaction.tooltip')"
                          >
                            <Trash2Icon class="size-3.5" />
                          </UiButton>
                        </DeleteInvestmentTransactionDialog>
                      </span>
                    </DesktopOnlyTooltip>
                  </div>
                </div>
              </template>
              <div v-else class="text-muted-foreground flex items-center justify-center px-3 py-2 text-xs">
                {{ $t('portfolioDetail.transactionsList.loadingMore') }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
