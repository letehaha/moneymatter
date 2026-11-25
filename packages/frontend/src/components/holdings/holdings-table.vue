<script setup lang="ts">
import { formatShare } from '@/common/utils/percentage';
import PrecisionNumber from '@/components/common/precision-number.vue';
import SecurityLogo from '@/components/common/security-logo.vue';
import { Button } from '@/components/lib/ui/button';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable/formatters';
import { getGainColorClass } from '@/composable/gain-color';
import { useDateLocale } from '@/composable/use-date-locale';
import { toLocalCurrencyNumber } from '@/js/helpers/formatters';
import { ROUTES_NAMES } from '@/routes/constants';
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
} from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';

import AddHoldingTransactionDialog from './add-holding-transaction-dialog.vue';
import { type HoldingSortKey, getPrice, groupHoldings, isPriceStale, sortHoldings } from './utils/holding-display';

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
  portfolioName?: string;
  /** Share of the whole portfolio per securityId, computed from the unfiltered holdings. */
  weights: ReadonlyMap<string, number | null>;
  // When the user is filtering via search, closed positions are shown inline
  // alongside active ones (no collapsible section).
  isFiltering?: boolean;
  // Set of securityIds the user added during the current session. These rows
  // sort to the very top so the user can keep adding transactions on a fresh
  // holding without scrolling through the rest of the portfolio.
  justAddedIds?: ReadonlySet<string>;
}>();
const emit = defineEmits<{ (e: 'addSymbol'): void; (e: 'importTransactions'): void; (e: 'clearFilter'): void }>();

const isTransactionModalOpen = ref(false);
const selectedHolding = ref<HoldingModel | null>(null);

const openTransactionModal = (holding: HoldingModel) => {
  selectedHolding.value = holding;
  isTransactionModalOpen.value = true;
};

const sortKey = ref<HoldingSortKey>('value');
const sortDir = ref<'asc' | 'desc'>('desc');

const { formatAmountByCurrencyCode } = useFormatCurrency();
const { format: formatDate } = useDateLocale();
const { currencies } = storeToRefs(useCurrenciesStore());
const formatCurrency = (amount: number, currencyCode: string) => {
  const userCurrency = currencies.value.find((c) => c.currency?.code === currencyCode.toUpperCase());
  if (!userCurrency) {
    return toLocalCurrencyNumber(amount, { currency: currencyCode });
  }
  return formatAmountByCurrencyCode({ amount, currencyCode: userCurrency.currencyCode });
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

type DisplayRow =
  | { kind: 'holding'; holding: HoldingModel; weight: number | null }
  | { kind: 'closedToggle'; count: number };

const toHoldingRow = ({ holding }: { holding: HoldingModel }) =>
  ({ kind: 'holding', holding, weight: props.weights.get(holding.securityId) ?? null }) as const;

/**
 * Flat list of rows to render. While filtering we show every match in one
 * combined sorted list; otherwise just-added rows lead, then active, then a
 * collapsible "Closed positions" toggle and (when expanded) the closed ones.
 */
const displayRows = computed<DisplayRow[]>(() => {
  if (props.isFiltering) {
    return sortHoldings({ holdings: props.holdings ?? [], sortKey: sortKey.value, sortDir: sortDir.value }).map(
      (holding) => toHoldingRow({ holding }),
    );
  }

  const { justAdded, active, closed } = groupedHoldings.value;
  const rows: DisplayRow[] = [
    ...justAdded.map((holding) => toHoldingRow({ holding })),
    ...active.map((holding) => toHoldingRow({ holding })),
  ];

  if (closed.length > 0) {
    rows.push({ kind: 'closedToggle', count: closed.length });
    if (closedExpanded.value) {
      rows.push(...closed.map((holding) => toHoldingRow({ holding })));
    }
  }

  return rows;
});

// Money columns render display-currency values when present; Price stays native.
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

const holdingRoute = (holding: HoldingModel) => ({
  name: ROUTES_NAMES.portfolioHolding,
  params: { portfolioId: props.portfolioId, securityId: holding.securityId },
});

const cellStyles = 'py-2';
const theadCellStyles = 'py-2';
const theadBgStyles = 'bg-table-header';
// The symbol cell pins to the left during horizontal scroll. It needs an opaque
// bg (scrolled columns would show through), so the row's translucent hover
// color is layered over the card bg as a background image.
const stickyBodyCellStyles =
  'sticky z-1 bg-card group-hover:bg-[linear-gradient(var(--color-hover),var(--color-hover))]';
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
          <PlusIcon class="size-4" />
          {{ $t('portfolioDetail.holdingsTable.addFirstHolding') }}
        </Button>
        <Button variant="ghost" @click="emit('importTransactions')">
          {{ $t('portfolioDetail.holdingsTable.importTransactions') }}
        </Button>
      </div>
    </div>

    <!-- Holdings Table -->
    <ScrollArea v-else viewport-class="overscroll-x-none" with-horizontal-scrollbar>
      <!-- pb-2.5 keeps the overlay horizontal scrollbar off the last row. -->
      <div class="pb-2.5">
        <table class="w-full min-w-190">
          <thead class="text-muted-foreground">
            <tr class="text-xs font-medium tracking-wider uppercase">
              <th :class="[theadCellStyles, theadBgStyles, 'sticky left-0 z-1 px-3 text-left']">
                <button
                  class="hover:text-foreground flex items-center gap-1 transition-colors"
                  @click="toggleSort('symbol')"
                >
                  <span :class="theadLabelStyles">{{ $t('portfolioDetail.holdingsTable.headers.symbol') }}</span>
                  <ArrowUpIcon v-if="sortKey === 'symbol' && sortDir === 'asc'" class="size-3" />
                  <ArrowDownIcon v-if="sortKey === 'symbol' && sortDir === 'desc'" class="size-3" />
                </button>
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
                  @click="toggleSort('value')"
                >
                  <span :class="theadLabelStyles">{{ $t('portfolioDetail.holdingsTable.headers.marketValue') }}</span>
                  <ArrowUpIcon v-if="sortKey === 'value' && sortDir === 'asc'" class="size-3" />
                  <ArrowDownIcon v-if="sortKey === 'value' && sortDir === 'desc'" class="size-3" />
                </button>
              </th>
              <th :class="[theadCellStyles, theadBgStyles, 'px-3 text-right']">
                <span :class="theadLabelStyles">{{ $t('portfolioDetail.holdingsTable.headers.weight') }}</span>
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
              <th :class="[theadCellStyles, theadBgStyles, 'w-24']"></th>
            </tr>
          </thead>
          <tbody class="divide-border divide-y">
            <template
              v-for="row in displayRows"
              :key="row.kind === 'closedToggle' ? 'closed-positions-toggle' : row.holding.securityId"
            >
              <!-- Inline collapsible "Closed positions" section header -->
              <tr v-if="row.kind === 'closedToggle'" class="bg-muted/40 text-sm">
                <td colspan="7" class="p-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="text-muted-foreground w-full justify-start"
                    :aria-expanded="closedExpanded"
                    @click="closedExpanded = !closedExpanded"
                  >
                    <ChevronDownIcon v-if="closedExpanded" class="size-4" />
                    <ChevronRightIcon v-else class="size-4" />
                    <ArchiveIcon class="size-4" />
                    {{ $t('portfolioDetail.holdingsTable.closedPositions', { count: row.count }) }}
                  </Button>
                </td>
              </tr>
              <tr v-else class="hover:bg-hover group text-sm">
                <td :class="[cellStyles, stickyBodyCellStyles, 'left-0 max-w-72 px-3']">
                  <RouterLink :to="holdingRoute(row.holding)" class="flex min-w-0 items-center gap-3">
                    <SecurityLogo v-if="row.holding.security" :security="row.holding.security" />
                    <span class="min-w-0">
                      <span class="block font-semibold">{{ row.holding.security?.symbol }}</span>
                      <span class="text-muted-foreground block truncate text-xs">{{ row.holding.security?.name }}</span>
                    </span>
                  </RouterLink>
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
                <td :class="[cellStyles, 'px-3 text-right font-semibold tabular-nums']">
                  {{
                    formatMoneyCell({
                      holding: row.holding,
                      native: Number(row.holding.marketValue || 0),
                      display: row.holding.displayMarketValue,
                    })
                  }}
                </td>
                <td :class="[cellStyles, 'px-3 text-right tabular-nums']">
                  <span v-if="row.weight === null">—</span>
                  <div v-else class="flex flex-col items-end gap-1">
                    <span>{{ formatShare({ fraction: row.weight }) }}</span>
                    <span class="bg-muted h-1 w-16 overflow-hidden rounded-full">
                      <span
                        class="bg-muted-foreground block h-full rounded-full"
                        :style="{ width: `${Math.min(100, row.weight * 100)}%` }"
                      />
                    </span>
                  </div>
                </td>
                <td :class="[cellStyles, 'px-3 text-right']">
                  <div
                    :class="getGainColorClass({ gainValue: Number(row.holding.unrealizedGainValue || 0) })"
                    class="tabular-nums"
                  >
                    <div class="font-semibold">
                      {{
                        formatMoneyCell({
                          holding: row.holding,
                          native: Number(row.holding.unrealizedGainValue || 0),
                          display: row.holding.displayUnrealizedGainValue,
                        })
                      }}
                    </div>
                    <div class="text-xs">{{ Number(row.holding.unrealizedGainPercent || 0).toFixed(2) }}%</div>
                  </div>
                </td>
                <td :class="[cellStyles, 'pr-2 text-right']">
                  <div class="flex items-center justify-end gap-1">
                    <DesktopOnlyTooltip :content="$t('portfolioDetail.holdingsTable.actions.addTransaction')">
                      <Button
                        variant="outline"
                        size="icon-sm"
                        :aria-label="
                          $t('portfolioDetail.holdingsTable.actions.addTransactionFor', {
                            symbol: row.holding.security?.symbol ?? '',
                          })
                        "
                        @click="openTransactionModal(row.holding)"
                      >
                        <PlusIcon class="size-4" />
                      </Button>
                    </DesktopOnlyTooltip>
                    <DesktopOnlyTooltip :content="$t('portfolioDetail.holdingsTable.actions.openHolding')">
                      <Button variant="ghost" size="icon-sm" class="hover:bg-transparent" as-child>
                        <RouterLink
                          :to="holdingRoute(row.holding)"
                          :aria-label="
                            $t('portfolioDetail.holdingsTable.actions.openHoldingFor', {
                              symbol: row.holding.security?.symbol ?? '',
                            })
                          "
                        >
                          <ChevronRightIcon class="size-4" />
                        </RouterLink>
                      </Button>
                    </DesktopOnlyTooltip>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </ScrollArea>

    <AddHoldingTransactionDialog
      v-model:open="isTransactionModalOpen"
      :portfolio-id="portfolioId"
      :holding="selectedHolding"
      :portfolio-name="portfolioName"
    />
  </div>
</template>
