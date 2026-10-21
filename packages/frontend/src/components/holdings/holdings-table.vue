<script setup lang="ts">
import PrecisionNumber from '@/components/common/precision-number.vue';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import InvestmentTransactionForm from '@/components/forms/investment-transaction-form.vue';
import { Button } from '@/components/lib/ui/button';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { provideChatPageContext } from '@/composable/chat/use-chat-page-context';
import { useDeleteHolding } from '@/composable/data-queries/holdings';
import { useFormatCurrency } from '@/composable/formatters';
import { getGainColorClass } from '@/composable/gain-color';
import { useDateLocale } from '@/composable/use-date-locale';
import { getApiErrorMessage } from '@/js/errors';
import { captureException } from '@/lib/sentry';
import { useCurrenciesStore } from '@/stores/currencies';
import { ASSET_CLASS, type HoldingModel } from '@bt/shared/types/investments';
import {
  AlertCircleIcon,
  ArchiveIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockAlertIcon,
  PackageOpenIcon,
  PlusIcon,
  SearchXIcon,
  Trash2Icon,
} from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import SecurityLogo from '@/components/common/security-logo.vue';

import HoldingTransactionsSection from './holding-transactions-section.vue';
import { useHoldingRowExpansion } from './composables/use-holding-row-expansion';
import {
  type HoldingSortKey,
  getAverageCost,
  getPrice,
  getTotalCost,
  groupHoldings,
  isPriceStale,
  sortHoldings,
} from './utils/holding-display';

// Crypto trades in much smaller units than typical stock fractional shares, so
// it needs more visible precision before falling back to a hover-reveal.
const QUANTITY_DECIMALS = { crypto: 4, default: 2 } as const;
const decimalsForAssetClass = (assetClass: ASSET_CLASS | undefined) =>
  assetClass === ASSET_CLASS.crypto ? QUANTITY_DECIMALS.crypto : QUANTITY_DECIMALS.default;

const props = defineProps<{
  holdings: HoldingModel[];
  loading?: boolean;
  error?: boolean;
  portfolioId: string;
  // When the user is filtering via search, closed positions are shown inline
  // alongside active ones (no collapsible section).
  isFiltering?: boolean;
  // Set of securityIds the user added during the current session. These rows
  // sort to the very top so the user can keep adding transactions on a fresh
  // holding without scrolling through the rest of the portfolio.
  justAddedIds?: ReadonlySet<string>;
}>();
const emit = defineEmits<{ (e: 'addSymbol'): void; (e: 'importTransactions'): void; (e: 'clearFilter'): void }>();

const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();

const isTransactionModalOpen = ref(false);
const selectedHolding = ref<HoldingModel | null>(null);

// While a holding's dialog is open, "this" in the chat means that holding (its id is the security's).
provideChatPageContext(() =>
  isTransactionModalOpen.value && selectedHolding.value
    ? { focus: { kind: 'holding', id: selectedHolding.value.securityId } }
    : {},
);

const openTransactionModal = (holding: HoldingModel | null = null) => {
  selectedHolding.value = holding;
  isTransactionModalOpen.value = true;
};

const sortKey = ref<HoldingSortKey>('totalCost');
const sortDir = ref<'asc' | 'desc'>('desc');

const { formatAmountByCurrencyCode } = useFormatCurrency();
const { format: formatDate } = useDateLocale();
const { currencies } = storeToRefs(useCurrenciesStore());
const formatCurrency = (amount: number, currencyCode: string) => {
  const userCurrency = currencies.value.find((c) => c.currency?.code === currencyCode.toUpperCase());
  if (!userCurrency) {
    return amount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return formatAmountByCurrencyCode(amount, userCurrency.currencyCode);
};

const toggleSort = (key: HoldingSortKey) => {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey.value = key;
    sortDir.value = 'asc';
  }
};

// Collapsible "Closed positions" section, collapsed by default.
const closedExpanded = ref(false);

const groupedHoldings = computed(() =>
  groupHoldings({
    holdings: props.holdings ?? [],
    sortKey: sortKey.value,
    sortDir: sortDir.value,
    justAddedIds: props.justAddedIds,
  }),
);

type DisplayRow = { kind: 'holding'; holding: HoldingModel } | { kind: 'closedToggle'; count: number };

/**
 * Flat list of rows to render. While filtering we show every match in one
 * combined sorted list; otherwise just-added rows lead, then active, then a
 * collapsible "Closed positions" toggle and (when expanded) the closed ones.
 */
const displayRows = computed<DisplayRow[]>(() => {
  if (props.isFiltering) {
    return sortHoldings({ holdings: props.holdings ?? [], sortKey: sortKey.value, sortDir: sortDir.value }).map(
      (holding) => ({ kind: 'holding', holding }),
    );
  }

  const { justAdded, active, closed } = groupedHoldings.value;
  const rows: DisplayRow[] = [
    ...justAdded.map((holding) => ({ kind: 'holding', holding }) as const),
    ...active.map((holding) => ({ kind: 'holding', holding }) as const),
  ];

  if (closed.length > 0) {
    rows.push({ kind: 'closedToggle', count: closed.length });
    if (closedExpanded.value) {
      rows.push(...closed.map((holding) => ({ kind: 'holding', holding }) as const));
    }
  }

  return rows;
});

const getUnrealizedGain = (holding: HoldingModel) => {
  return {
    value: Number(holding.unrealizedGainValue || 0),
    percent: Number(holding.unrealizedGainPercent || 0),
  };
};

const getRealizedGain = (holding: HoldingModel) => {
  return {
    value: Number(holding.realizedGainValue || 0),
    percent: Number(holding.realizedGainPercent || 0),
  };
};

// Money columns render display-currency values when present; Price and AC/Share stay native.
const formatMoneyCell = ({
  holding,
  native,
  display,
}: {
  holding: HoldingModel;
  native: number;
  display: string | undefined;
}) =>
  holding.displayCurrencyCode && display !== undefined
    ? formatCurrency(Number(display), holding.displayCurrencyCode)
    : formatCurrency(native, holding.currencyCode);

const { isExpanded, toggleExpand, collapseIfMatches } = useHoldingRowExpansion();

// Delete holding flow
const deleteHoldingMutation = useDeleteHolding();
const deleteConfirmOpen = ref(false);
const holdingPendingDelete = ref<HoldingModel | null>(null);

const openDeleteConfirm = (holding: HoldingModel) => {
  holdingPendingDelete.value = holding;
  deleteConfirmOpen.value = true;
};

const confirmDeleteHolding = async () => {
  const target = holdingPendingDelete.value;
  if (!target) return;
  try {
    await deleteHoldingMutation.mutateAsync({
      portfolioId: props.portfolioId,
      securityId: target.securityId,
      force: true,
    });
    addSuccessNotification(t('portfolioDetail.holdingsTable.deleteHolding.success'));
    collapseIfMatches(target.securityId);
  } catch (err) {
    const message = getApiErrorMessage({
      e: err,
      t,
      conflictKey: 'portfolioDetail.holdingsTable.deleteHolding.error',
      fallbackKey: 'portfolioDetail.holdingsTable.deleteHolding.error',
    });
    addErrorNotification(message);
    captureException({
      error: err,
      context: { source: 'confirmDeleteHolding', portfolioId: props.portfolioId, securityId: target.securityId },
    });
  } finally {
    deleteConfirmOpen.value = false;
    holdingPendingDelete.value = null;
  }
};

const cellStyles = 'py-0.5';
const theadCellStyles = 'py-2';
const theadBgStyles = 'bg-muted';
// Chevron + Symbol cells pin to the left during horizontal scroll. They need
// an opaque bg (scrolled columns would show through), so the row's transparent
// bg-muted/30 hover is pre-blended with the card bg via color-mix.
const stickyBodyCellStyles =
  'sticky z-1 bg-card transition-colors group-hover:bg-[color-mix(in_oklab,var(--muted)_30%,var(--card))]';
// Single-line header labels: the cap keeps long (localized) labels from
// wrapping or blowing up column widths; overflow turns into an ellipsis.
const theadLabelStyles = 'block max-w-32 truncate';
</script>

<template>
  <div>
    <!-- Loading State with Skeleton -->
    <div v-if="loading" class="py-8">
      <div class="space-y-1">
        <div class="flex items-center gap-4 border-b pb-2">
          <div class="h-4 w-8"></div>
          <div class="bg-muted h-4 w-20 animate-pulse rounded"></div>
          <div class="bg-muted h-4 w-32 animate-pulse rounded"></div>
          <div class="bg-muted ml-auto h-4 w-16 animate-pulse rounded"></div>
          <div class="bg-muted h-4 w-16 animate-pulse rounded"></div>
          <div class="bg-muted h-4 w-20 animate-pulse rounded"></div>
          <div class="bg-muted h-4 w-20 animate-pulse rounded"></div>
          <div class="bg-muted h-8 w-20 animate-pulse rounded"></div>
          <div class="bg-muted h-8 w-20 animate-pulse rounded"></div>
        </div>
        <div v-for="i in 5" :key="i" class="flex items-center gap-4 py-3">
          <div class="bg-muted h-8 w-8 animate-pulse rounded"></div>
          <div class="bg-muted h-4 w-20 animate-pulse rounded"></div>
          <div class="bg-muted h-4 w-32 animate-pulse rounded"></div>
          <div class="bg-muted ml-auto h-4 w-16 animate-pulse rounded"></div>
          <div class="bg-muted h-4 w-16 animate-pulse rounded"></div>
          <div class="bg-muted h-4 w-20 animate-pulse rounded"></div>
          <div class="bg-muted h-4 w-20 animate-pulse rounded"></div>
          <div class="bg-muted h-4 w-20 animate-pulse rounded"></div>
          <div class="flex h-10 flex-col justify-center gap-1">
            <div class="bg-muted h-4 w-20 animate-pulse rounded"></div>
            <div class="bg-muted h-3 w-16 animate-pulse rounded"></div>
          </div>
          <div class="flex h-10 flex-col justify-center gap-1">
            <div class="bg-muted h-4 w-20 animate-pulse rounded"></div>
            <div class="bg-muted h-3 w-16 animate-pulse rounded"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="py-12 text-center">
      <div class="bg-destructive/10 mx-auto mb-3 flex size-12 items-center justify-center rounded-full">
        <AlertCircleIcon class="text-destructive-text size-6" />
      </div>
      <p class="text-destructive-text mb-2 font-medium">{{ $t('portfolioDetail.holdingsTable.loadError') }}</p>
      <p class="text-muted-foreground text-sm">{{ $t('portfolioDetail.holdingsTable.tryAgainLater') }}</p>
    </div>

    <!-- No Search Matches State: holdings exist, the filter just excluded all of them -->
    <div v-else-if="isFiltering && (!holdings || holdings.length === 0)" class="py-12 text-center">
      <div class="bg-muted mx-auto mb-4 flex size-12 items-center justify-center rounded-full">
        <SearchXIcon class="text-muted-foreground size-6" />
      </div>
      <p class="text-foreground mb-2 font-medium">{{ $t('portfolioDetail.holdingsTable.noFilterResults') }}</p>
      <p class="text-muted-foreground mb-4 text-sm">
        {{ $t('portfolioDetail.holdingsTable.noFilterResultsDescription') }}
      </p>
      <Button variant="outline" @click="emit('clearFilter')">
        {{ $t('portfolioDetail.holdingsTable.clearFilterButton') }}
      </Button>
    </div>

    <!-- Empty State -->
    <div v-else-if="!holdings || holdings.length === 0" class="py-12 text-center">
      <div class="bg-muted mx-auto mb-4 flex size-12 items-center justify-center rounded-full">
        <PackageOpenIcon class="text-muted-foreground size-6" />
      </div>
      <p class="text-foreground mb-2 font-medium">{{ $t('portfolioDetail.holdingsTable.empty') }}</p>
      <p class="text-muted-foreground mb-4 text-sm">{{ $t('portfolioDetail.holdingsTable.emptyDescription') }}</p>
      <div class="flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" @click="emit('addSymbol')">
          <PlusIcon class="mr-2 size-4" />
          {{ $t('portfolioDetail.holdingsTable.addFirstHolding') }}
        </Button>
        <Button variant="ghost" @click="emit('importTransactions')">
          {{ $t('portfolioDetail.holdingsTable.importTransactions') }}
        </Button>
      </div>
    </div>

    <!-- Holdings Table -->
    <!-- @container: the expanded transactions section sizes itself to 100cqw. -->
    <ScrollArea v-else class="@container" viewport-class="overscroll-x-none" with-horizontal-scrollbar>
      <!-- pb-2.5 keeps the overlay horizontal scrollbar off the last row. -->
      <div class="pb-2.5">
        <table class="w-full min-w-235">
          <thead class="text-muted-foreground">
            <tr class="text-xs font-medium tracking-wider uppercase">
              <!-- Chevron + symbol share one sticky cell: separate cells leave a
                   seam where scrolled columns peek through between them. -->
              <th :class="[theadCellStyles, theadBgStyles, 'sticky left-0 z-1 pr-3 pl-13 text-left']">
                <button
                  class="hover:text-foreground flex items-center gap-1 transition-colors"
                  @click="toggleSort('symbol')"
                >
                  <span :class="theadLabelStyles">{{ $t('portfolioDetail.holdingsTable.headers.symbol') }}</span>
                  <ArrowUpIcon v-if="sortKey === 'symbol' && sortDir === 'asc'" class="size-3" />
                  <ArrowDownIcon v-if="sortKey === 'symbol' && sortDir === 'desc'" class="size-3" />
                </button>
              </th>
              <th :class="[theadCellStyles, theadBgStyles, 'px-3 text-left']">
                <span :class="theadLabelStyles">{{ $t('portfolioDetail.holdingsTable.headers.name') }}</span>
              </th>
              <th :class="[theadCellStyles, theadBgStyles, 'px-3 text-right']">
                <button
                  class="hover:text-foreground flex w-full items-center justify-end gap-1 transition-colors"
                  @click="toggleSort('quantity')"
                >
                  <span :class="theadLabelStyles">{{ $t('portfolioDetail.holdingsTable.headers.shares') }}</span>
                  <ArrowUpIcon v-if="sortKey === 'quantity' && sortDir === 'asc'" class="size-3" />
                  <ArrowDownIcon v-if="sortKey === 'quantity' && sortDir === 'desc'" class="size-3" />
                </button>
              </th>
              <th :class="[theadCellStyles, theadBgStyles, 'px-3 text-right']">
                <span :class="theadLabelStyles">{{ $t('portfolioDetail.holdingsTable.headers.price') }}</span>
              </th>
              <th :class="[theadCellStyles, theadBgStyles, 'px-3 text-right']">
                <button
                  class="hover:text-foreground flex w-full items-center justify-end gap-1 transition-colors"
                  @click="toggleSort('avgCost')"
                >
                  <span :class="theadLabelStyles">{{
                    $t('portfolioDetail.holdingsTable.headers.avgCostPerShare')
                  }}</span>
                  <ArrowUpIcon v-if="sortKey === 'avgCost' && sortDir === 'asc'" class="size-3" />
                  <ArrowDownIcon v-if="sortKey === 'avgCost' && sortDir === 'desc'" class="size-3" />
                </button>
              </th>
              <th :class="[theadCellStyles, theadBgStyles, 'px-3 text-right']">
                <button
                  class="hover:text-foreground flex w-full items-center justify-end gap-1 transition-colors"
                  @click="toggleSort('totalCost')"
                >
                  <span :class="theadLabelStyles">{{ $t('portfolioDetail.holdingsTable.headers.totalCost') }}</span>
                  <ArrowUpIcon v-if="sortKey === 'totalCost' && sortDir === 'asc'" class="size-3" />
                  <ArrowDownIcon v-if="sortKey === 'totalCost' && sortDir === 'desc'" class="size-3" />
                </button>
              </th>
              <th :class="[theadCellStyles, theadBgStyles, 'px-3 text-right']">
                <button
                  class="hover:text-foreground flex w-full items-center justify-end gap-1 transition-colors"
                  @click="toggleSort('value')"
                >
                  <span :class="theadLabelStyles">{{ $t('portfolioDetail.holdingsTable.headers.marketValue') }}</span>
                  <ArrowUpIcon v-if="sortKey === 'value' && sortDir === 'asc'" class="size-3" />
                  <ArrowDownIcon v-if="sortKey === 'value' && sortDir === 'desc'" class="size-3" />
                </button>
              </th>
              <th :class="[theadCellStyles, theadBgStyles, 'px-3 text-right']">
                <button
                  class="hover:text-foreground flex w-full items-center justify-end gap-1 transition-colors"
                  @click="toggleSort('unrealizedGain')"
                >
                  <span :class="theadLabelStyles">{{
                    $t('portfolioDetail.holdingsTable.headers.unrealizedGain')
                  }}</span>
                  <ArrowUpIcon v-if="sortKey === 'unrealizedGain' && sortDir === 'asc'" class="size-3" />
                  <ArrowDownIcon v-if="sortKey === 'unrealizedGain' && sortDir === 'desc'" class="size-3" />
                </button>
              </th>
              <th :class="[theadCellStyles, theadBgStyles, 'px-3 text-right']">
                <button
                  class="hover:text-foreground flex w-full items-center justify-end gap-1 transition-colors"
                  @click="toggleSort('realizedGain')"
                >
                  <span :class="theadLabelStyles">{{ $t('portfolioDetail.holdingsTable.headers.realizedGain') }}</span>
                  <ArrowUpIcon v-if="sortKey === 'realizedGain' && sortDir === 'asc'" class="size-3" />
                  <ArrowDownIcon v-if="sortKey === 'realizedGain' && sortDir === 'desc'" class="size-3" />
                </button>
              </th>
              <th :class="[theadCellStyles, theadBgStyles, 'w-10 text-right']"></th>
            </tr>
          </thead>
          <tbody class="divide-border divide-y">
            <template
              v-for="row in displayRows"
              :key="row.kind === 'closedToggle' ? 'closed-positions-toggle' : row.holding.securityId"
            >
              <!-- Inline collapsible "Closed positions" section header -->
              <tr
                v-if="row.kind === 'closedToggle'"
                class="bg-muted/40 hover:bg-muted/70 cursor-pointer text-sm transition-colors"
                @click="closedExpanded = !closedExpanded"
              >
                <td :class="[cellStyles, 'py-1']">
                  <Button variant="ghost" size="icon" class="size-8" @click.stop="closedExpanded = !closedExpanded">
                    <ChevronDownIcon v-if="closedExpanded" class="size-4" />
                    <ChevronRightIcon v-else class="size-4" />
                  </Button>
                </td>
                <td colspan="9" :class="[cellStyles, 'px-3']">
                  <div class="text-muted-foreground flex items-center gap-2 font-medium">
                    <ArchiveIcon class="size-4" />
                    {{ $t('portfolioDetail.holdingsTable.closedPositions', { count: row.count }) }}
                  </div>
                </td>
              </tr>
              <template v-else>
                <tr class="hover:bg-muted/30 group text-sm transition-colors">
                  <td :class="[cellStyles, stickyBodyCellStyles, 'left-0 py-1 pr-3 font-semibold']">
                    <div class="flex items-center gap-2">
                      <Button variant="ghost" size="icon" class="size-8" @click="toggleExpand(row.holding.securityId)">
                        <ChevronDownIcon v-if="isExpanded(row.holding.securityId)" class="size-4" />
                        <ChevronRightIcon v-else class="size-4" />
                      </Button>
                      <SecurityLogo v-if="row.holding.security" :security="row.holding.security" />
                      <span>{{ row.holding.security?.symbol }}</span>
                    </div>
                  </td>
                  <td :class="[cellStyles, 'text-muted-foreground max-w-50 truncate px-3']">
                    {{ row.holding.security?.name }}
                  </td>
                  <td :class="[cellStyles, 'px-3 text-right tabular-nums']">
                    <PrecisionNumber
                      :value="row.holding.quantity"
                      :max-decimals="decimalsForAssetClass(row.holding.security?.assetClass)"
                    />
                  </td>
                  <td :class="[cellStyles, 'px-3 text-right tabular-nums']">
                    {{ formatCurrency(getPrice(row.holding), row.holding.currencyCode) }}
                    <DesktopOnlyTooltip
                      v-if="isPriceStale({ holding: row.holding })"
                      content-class-name="max-w-60"
                      :content="$t('portfolioDetail.holdingsTable.stalePrice')"
                    >
                      <div class="text-warning-text flex items-center justify-end gap-1 text-xs">
                        <ClockAlertIcon class="size-3" />
                        {{ formatDate(row.holding.priceDate!, 'd MMM') }}
                      </div>
                    </DesktopOnlyTooltip>
                  </td>
                  <td :class="[cellStyles, 'text-muted-foreground px-3 text-right tabular-nums']">
                    {{ formatCurrency(getAverageCost(row.holding), row.holding.currencyCode) }}
                  </td>
                  <td :class="[cellStyles, 'px-3 text-right tabular-nums']">
                    {{
                      formatMoneyCell({
                        holding: row.holding,
                        native: getTotalCost(row.holding),
                        display: row.holding.displayCostBasis,
                      })
                    }}
                  </td>
                  <td :class="[cellStyles, 'px-3 text-right font-medium tabular-nums']">
                    {{
                      formatMoneyCell({
                        holding: row.holding,
                        native: Number(row.holding.marketValue || 0),
                        display: row.holding.displayMarketValue,
                      })
                    }}
                  </td>
                  <td :class="[cellStyles, 'px-3 text-right']">
                    <div
                      :class="getGainColorClass({ gainValue: getUnrealizedGain(row.holding).value })"
                      class="tabular-nums"
                    >
                      <div class="font-semibold">
                        {{
                          formatMoneyCell({
                            holding: row.holding,
                            native: getUnrealizedGain(row.holding).value,
                            display: row.holding.displayUnrealizedGainValue,
                          })
                        }}
                      </div>
                      <div class="text-xs">{{ getUnrealizedGain(row.holding).percent.toFixed(2) }}%</div>
                    </div>
                  </td>
                  <td :class="[cellStyles, 'px-3 text-right']">
                    <div
                      :class="getGainColorClass({ gainValue: getRealizedGain(row.holding).value })"
                      class="tabular-nums"
                    >
                      <div class="font-semibold">
                        {{
                          formatMoneyCell({
                            holding: row.holding,
                            native: getRealizedGain(row.holding).value,
                            display: row.holding.displayRealizedGainValue,
                          })
                        }}
                      </div>
                      <div class="text-xs">{{ getRealizedGain(row.holding).percent.toFixed(2) }}%</div>
                    </div>
                  </td>
                  <td :class="[cellStyles, 'py-1 pr-2 text-right']">
                    <DesktopOnlyTooltip :content="$t('portfolioDetail.holdingsTable.deleteHolding.ariaLabel')">
                      <Button
                        variant="ghost-destructive"
                        size="icon"
                        class="size-8"
                        :aria-label="$t('portfolioDetail.holdingsTable.deleteHolding.ariaLabel')"
                        @click="openDeleteConfirm(row.holding)"
                      >
                        <Trash2Icon class="size-4" />
                      </Button>
                    </DesktopOnlyTooltip>
                  </td>
                </tr>
                <!-- Expanded transactions section -->
                <tr v-if="isExpanded(row.holding.securityId)" class="bg-muted/20">
                  <td colspan="10" class="p-0">
                    <HoldingTransactionsSection
                      :portfolio-id="portfolioId"
                      :security-id="row.holding.securityId"
                      @add-transaction="openTransactionModal(row.holding)"
                    />
                  </td>
                </tr>
              </template>
            </template>
          </tbody>
        </table>
      </div>
    </ScrollArea>

    <ResponsiveDialog v-model:open="isTransactionModalOpen" dialog-content-class="sm:max-w-2xl">
      <template #title>{{ $t('portfolioDetail.holdingsTable.addTransactionDialog.title') }}</template>
      <template #description>
        {{ $t('portfolioDetail.holdingsTable.addTransactionDialog.description') }}
      </template>
      <InvestmentTransactionForm
        :portfolio-id="portfolioId"
        :securities="
          holdings.map((hh) => ({
            value: String(hh.securityId),
            label: hh.security?.name
              ? `${hh.security.name} (${hh.security.symbol})`
              : (hh.security?.symbol ?? 'Unknown'),
            currencyCode: hh.currencyCode,
          }))
        "
        :security-id="selectedHolding?.securityId ? String(selectedHolding.securityId) : undefined"
        @success="isTransactionModalOpen = false"
        @cancel="isTransactionModalOpen = false"
      />
    </ResponsiveDialog>

    <ResponsiveAlertDialog
      v-model:open="deleteConfirmOpen"
      :confirm-label="$t('portfolioDetail.holdingsTable.deleteHolding.confirmLabel')"
      confirm-variant="destructive"
      :confirm-disabled="deleteHoldingMutation.isPending.value"
      @confirm="confirmDeleteHolding"
    >
      <template #title>{{ $t('portfolioDetail.holdingsTable.deleteHolding.title') }}</template>
      <template #description>
        <i18n-t keypath="portfolioDetail.holdingsTable.deleteHolding.description" tag="span">
          <template #symbol>
            <strong>{{ holdingPendingDelete?.security?.symbol ?? '' }}</strong>
          </template>
        </i18n-t>
      </template>
    </ResponsiveAlertDialog>
  </div>
</template>
