<template>
  <WidgetWrapper :is-fetching="isWidgetDataFetching" class="min-h-80">
    <template #title>
      <div class="flex w-full items-center gap-4">
        <span>{{ $t('dashboard.widgets.balanceTrend.title') }}</span>
        <SelectField
          v-model="selectedBalanceType"
          :values="balanceTypeOptions"
          value-key="value"
          label-key="label"
          class="w-35 text-xs"
          :disabled="isWidgetDataFetching"
        />
      </div>
    </template>
    <template v-if="widgetConfigRef" #action>
      <BalanceTrendSettingsPopover :is-projection-active="projection !== null" />
    </template>
    <template v-if="isInitialLoading">
      <LoadingState />
    </template>
    <template v-else-if="isDataEmpty">
      <EmptyState>
        <ChartLineIcon class="size-32" />
      </EmptyState>
    </template>
    <template v-else>
      <!-- Stats row - two columns with space between -->
      <div class="max-xs:px-2 mb-4 flex items-start justify-between gap-4">
        <!-- Left: Primary value -->
        <div>
          <div class="text-2xl font-bold tracking-tight">
            {{ formatBaseCurrency(animatedBalance) }}
          </div>
          <div class="text-muted-foreground mt-1 text-xs font-medium tracking-tight uppercase">
            {{ periodLabel }}
          </div>
        </div>

        <!-- Right: Comparison -->
        <div class="flex min-w-0 flex-1 flex-col items-end gap-1">
          <div class="flex w-full items-center gap-1.5">
            <FitAmount
              :value="balancesDiffAbsolute"
              signed
              class="flex-1 text-right text-sm font-semibold tracking-tight"
              :class="{
                'text-app-expense-color': balancesDiff < 0,
                'text-success-text': balancesDiff > 0,
                'text-muted-foreground': balancesDiff === 0,
              }"
            />
            <span
              class="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold"
              :class="{
                'bg-app-expense-color/15 text-app-expense-color': balancesDiff < 0,
                'bg-success-text/15 text-success-text': balancesDiff > 0,
                'bg-muted text-muted-foreground': balancesDiff === 0,
              }"
            >
              {{ balancesDiff > 0 ? '+' : '' }}{{ balancesDiff }}%
            </span>
          </div>
          <div class="text-muted-foreground text-xs tracking-tight">
            {{ $t('dashboard.widgets.balanceTrend.vsPreviousPeriod') }}
          </div>
        </div>
      </div>

      <!-- Projected balance from pending plans; the headline above stays real-money only. -->
      <i18n-t
        v-if="projection"
        keypath="dashboard.widgets.balanceTrend.projection.summary"
        :plural="projection.planCount"
        tag="div"
        data-testid="bt-projection-summary"
        class="max-xs:px-2 text-muted-foreground -mt-2 mb-3 text-xs"
      >
        <template #amount>
          <span class="text-foreground text-sm font-semibold">{{ formatBaseCurrency(projection.projectedValue) }}</span>
        </template>
        <template #count>{{ projection.planCount }}</template>
        <template #date>{{ projectionThroughDate }}</template>
      </i18n-t>

      <Transition name="chart-fade" mode="out-in">
        <div :key="chartKey" ref="containerRef" class="max-xs:px-2 relative min-h-44 w-full flex-1">
          <svg ref="svgRef" class="h-full w-full"></svg>

          <!-- Tooltip -->
          <div
            v-show="tooltip.visible"
            ref="tooltipRef"
            class="pointer-events-none fixed z-50"
            :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
          >
            <ChartTooltip>
              <ChartTooltipHeader>{{ tooltip.date }}</ChartTooltipHeader>

              <ChartTooltipRow v-for="row in tooltipComponentRows" :key="row.key" :label="row.label">
                <template #value>
                  {{ formatTooltipMoney(row.value)
                  }}<span
                    v-if="shouldDisplayBalanceDelta({ delta: row.delta })"
                    class="ml-1 text-xs font-medium"
                    :class="deltaColorClass(row.delta)"
                    >({{ formatBalanceDelta({ delta: row.delta, currency: tooltipCurrency }) }})</span
                  >
                </template>
              </ChartTooltipRow>

              <ChartTooltipDivider />

              <ChartTooltipRow
                total
                :label="$t('dashboard.widgets.balanceTrend.tooltip.total')"
                :value="formatTooltipMoney(tooltip.totalBalance)"
              />

              <div
                v-if="tooltip.hasDelta"
                class="mt-1 text-xs font-semibold tabular-nums"
                :class="deltaColorClass(tooltip.deltaAbsolute)"
              >
                {{ formatBalanceDelta({ delta: tooltip.deltaAbsolute, currency: tooltipCurrency }) }}
                ({{ formatBalanceDeltaPercent({ percent: tooltip.deltaPercent }) }})
              </div>
            </ChartTooltip>
          </div>

          <!-- Spike transactions panel -->
          <SpikeTransactionsPanel
            ref="spikePanelRef"
            :visible="spikePanel.visible"
            :x="spikePanel.x"
            :y="spikePanel.y"
            :spike-date="spikeDateLabel"
            :delta-absolute="spikePanel.spikePoint?.deltaAbsolute ?? 0"
            :delta-percent="spikePanel.spikePoint?.deltaPercent ?? 0"
            :is-positive="spikePanel.spikePoint?.isPositive ?? true"
            :transactions="spikeTransactions ?? []"
            :is-loading="isSpikeTransactionsLoading"
            :is-portfolio-mode="isPortfolioMode"
            :accounts-delta="spikePanel.accountsDelta"
            :portfolios-delta="spikePanel.portfoliosDelta"
            :selected-balance-type="selectedBalanceType.value"
            :currency-code="baseCurrency?.currency?.code"
            @close="closeSpikePanel"
            @see-all="navigateToSpikeTransactions"
          />
        </div>
      </Transition>
    </template>
  </WidgetWrapper>
</template>

<script lang="ts" setup>
import { loadTransactions } from '@/api/transactions';
import type { DashboardWidgetConfig } from '@/api/user-settings';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import {
  ChartTooltip,
  ChartTooltipDivider,
  ChartTooltipHeader,
  ChartTooltipRow,
} from '@/components/common/charts/chart-tooltip';
import FitAmount from '@/components/common/fit-amount.vue';
import SelectField from '@/components/fields/select-field.vue';
import { useFormatCurrency } from '@/composable';
import { getChartColors } from '@/composable/charts/chart-colors';
import { formatAxisCurrency } from '@/composable/charts/format-axis-currency';
import { useChartTooltipPosition } from '@/composable/charts/use-chart-tooltip-position';
import {
  SPIKE_DEFAULTS,
  type SpikeDetectionOptions,
  type SpikePoint,
  useSpikeDetection,
} from '@/composable/charts/use-spike-detection';
import { useAnimatedNumber } from '@/composable/use-animated-number';
import { currentTheme } from '@/common/utils/color-theme';
import { calculatePercentageDifference, formatLargeNumber } from '@/js/helpers';
import { ROUTES_NAMES } from '@/routes/constants';
import { loadCombinedBalanceTrendData } from '@/services/stats';
import { useAccountsStore, useCurrenciesStore } from '@/stores';
import { SORT_DIRECTIONS } from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import { useResizeObserver } from '@vueuse/core';
import * as d3 from 'd3';
import { differenceInDays, endOfDay, format, isSameMonth, min, startOfDay, subDays } from 'date-fns';
import { ChartLineIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import type { Ref } from 'vue';
import { computed, inject, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { selectProjectedTotalAccounts, usePlannedDateLabel } from '@/composable/use-projected-balance';

import { formatBalanceDelta, formatBalanceDeltaPercent, shouldDisplayBalanceDelta } from './balance-trend-delta';
import { type BalanceProjection, buildBalanceProjection } from './balance-trend-projection';
import BalanceTrendSettingsPopover from './components/balance-trend-settings-popover.vue';
import { readIncludePlanned } from './use-include-planned-config';
import EmptyState from './components/empty-state.vue';
import LoadingState from './components/loading-state.vue';
import SpikeTransactionsPanel from './components/spike-transactions-panel.vue';
import WidgetWrapper from './components/widget-wrapper.vue';
import { type NetWorthComponentBalances, type NetWorthIncludeSettings, composeNetWorth } from './net-worth-composition';

// Calculate it manually so chart will always have first and last ticks (dates)
function generateDateSteps({
  datesToShow = 5,
  fromDate,
  toDate,
}: {
  datesToShow?: number;
  fromDate: Date;
  toDate: Date;
}) {
  const start = startOfDay(fromDate).getTime();
  const end = startOfDay(toDate).getTime();
  const duration = end - start;
  const dates = [start];

  for (let i = 1; i < datesToShow - 1; i++) {
    const nextDate = start + (duration * i) / (datesToShow - 1);
    dates.push(Math.floor(nextDate));
  }

  dates.push(end);

  return dates;
}

defineOptions({
  name: 'balance-trend-widget',
});

const props = defineProps<{
  selectedPeriod: { from: Date; to: Date };
}>();

const { t } = useI18n();

type BalanceTypeValue = 'total' | 'accounts' | 'portfolios' | 'ventures' | 'vehicles' | 'loans';
type BalanceTypeOption = { value: BalanceTypeValue; label: string };

const selectedBalanceType = ref<BalanceTypeOption>({
  value: 'total',
  label: t('dashboard.widgets.balanceTrend.balanceTypes.total'),
});
const { formatBaseCurrency, getCurrencySymbol } = useFormatCurrency();
const { baseCurrency } = storeToRefs(useCurrenciesStore());
const { accounts } = storeToRefs(useAccountsStore());

// --- Spike settings (read from persisted dashboard widget config) ---
const widgetConfigRef = inject<Ref<DashboardWidgetConfig> | null>('dashboard-widget-config', null);

const spikeSettings = computed<SpikeDetectionOptions>(() => {
  const cfg = widgetConfigRef?.value?.config;
  return {
    enabled: (cfg?.spikesEnabled as boolean) ?? SPIKE_DEFAULTS.enabled,
    percentThreshold: (cfg?.spikePercentThreshold as number) ?? SPIKE_DEFAULTS.percentThreshold,
    absoluteThreshold: (cfg?.spikeAbsoluteThreshold as number) ?? SPIKE_DEFAULTS.absoluteThreshold,
    maxSpikes: (cfg?.spikeMaxCount as number) ?? SPIKE_DEFAULTS.maxSpikes,
  };
});

// When true, the chart x-axis is trimmed to the most recent data point.
// When false, it spans the full selected period (future dates appear empty).
const fitToLatestData = computed<boolean>(() => {
  const cfg = widgetConfigRef?.value?.config;
  return (cfg?.fitToLatestData as boolean | undefined) ?? true;
});

// User-controlled toggles for what counts toward the "Total" balance line.
// Default true so behavior matches pre-toggle releases (no migration needed).
// Affects the "total" chart line + tooltip total + headline number only; the
// per-component balance types (vehicles, ventures, loans) in the dropdown stay
// unaffected so users can still drill into them directly.
const includeVehiclesInTotal = computed<boolean>(() => {
  const cfg = widgetConfigRef?.value?.config;
  return (cfg?.includeVehiclesInTotal as boolean | undefined) ?? true;
});
const includeVenturesInTotal = computed<boolean>(() => {
  const cfg = widgetConfigRef?.value?.config;
  return (cfg?.includeVenturesInTotal as boolean | undefined) ?? true;
});
const includeLoansInTotal = computed<boolean>(() => {
  const cfg = widgetConfigRef?.value?.config;
  return (cfg?.includeLoansInTotal as boolean | undefined) ?? true;
});

const compositionSettings = computed<NetWorthIncludeSettings>(() => ({
  includeVentures: includeVenturesInTotal.value,
  includeVehicles: includeVehiclesInTotal.value,
  includeLoans: includeLoansInTotal.value,
}));
const includePlanned = computed<boolean>(() => readIncludePlanned({ config: widgetConfigRef?.value?.config }));

const getEffectiveTotal = (point: NetWorthComponentBalances): number =>
  composeNetWorth({ point, settings: compositionSettings.value });

const containerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const tooltipRef = ref<HTMLDivElement | null>(null);

const tooltip = reactive({
  visible: false,
  x: 0,
  y: 0,
  date: '',
  accountsBalance: 0,
  portfoliosBalance: 0,
  venturesBalance: 0,
  vehiclesBalance: 0,
  loansBalance: 0,
  totalBalance: 0,
  // Point-over-point change of each component, so the tooltip can show which
  // portion of net worth actually moved between the hovered day and the prior one.
  accountsDelta: 0,
  portfoliosDelta: 0,
  venturesDelta: 0,
  vehiclesDelta: 0,
  loansDelta: 0,
  // Change of the currently-charted line (matches the selected balance type).
  deltaAbsolute: 0,
  deltaPercent: 0,
  hasDelta: false,
});

const { updateTooltipPosition } = useChartTooltipPosition({
  containerRef,
  tooltipRef,
  tooltip,
  strategy: 'fixed',
});

// We store actual and prev period separately, so when new data is loading, we
// can still show the old period, to avoid UI flickering
const actualDataPeriod = ref(props.selectedPeriod);
const prevDataPeriod = ref(props.selectedPeriod);
// Include both from and to in query key to ensure cache invalidation when period changes
const periodQueryKey = computed(() => `${props.selectedPeriod.from.getTime()}-${props.selectedPeriod.to.getTime()}`);

// For data fetching, cap the 'to' date at today - we can't have balance history
// for future dates. The chart x-axis end is controlled separately by `chartXAxisEnd`.
const fetchPeriod = computed(() => ({
  from: props.selectedPeriod.from,
  to: min([props.selectedPeriod.to, new Date()]),
}));

const { data: balanceHistory, isFetching: isBalanceHistoryFetching } = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.widgetBalanceTrend, periodQueryKey],
  queryFn: () => loadCombinedBalanceTrendData(fetchPeriod.value),
  staleTime: Infinity,
  placeholderData: (prevData) => prevData,
});

// Fetch the previous period's balance to compare against
// The previous period has the same duration and ends right before the current period starts
const prevPeriod = computed(() => {
  const durationInDays = differenceInDays(props.selectedPeriod.to, props.selectedPeriod.from) + 1;
  const prevTo = subDays(props.selectedPeriod.from, 1); // Day before current period starts
  const prevFrom = subDays(props.selectedPeriod.from, durationInDays);

  return {
    from: prevFrom,
    to: min([prevTo, new Date()]),
  };
});

const { data: prevPeriodBalance, isFetching: isPrevPeriodBalanceFetching } = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.widgetBalanceTrendPrev, periodQueryKey],
  queryFn: () => loadCombinedBalanceTrendData(prevPeriod.value),
  staleTime: Infinity,
  placeholderData: (prevData) => prevData,
});

const isWidgetDataFetching = computed(() => isBalanceHistoryFetching.value || isPrevPeriodBalanceFetching.value);
// Only show full loading state on initial load (when we have no data to display)
const isInitialLoading = computed(() => isWidgetDataFetching.value && !balanceHistory.value);

// On each "selectedPeriod" change we immediately set it as "actualDataPeriod"
// but if "isWidgetDataFetching" is also triggered, means we started loading new
// data, then we need to actually reassing "actualDataPeriod" to be as "prevDataPeriod",
// so there won't be any data flickering. Once data is fully loaded, we assign
// actual values to both of them
watch(
  () => props.selectedPeriod,
  (value) => {
    actualDataPeriod.value = value;
  },
);
watch(
  isWidgetDataFetching,
  (value) => {
    if (value) {
      actualDataPeriod.value = prevDataPeriod.value;
    } else {
      actualDataPeriod.value = props.selectedPeriod;
      prevDataPeriod.value = props.selectedPeriod;
    }
  },
  { immediate: true },
);

const isDataEmpty = computed(
  () => !balanceHistory.value || balanceHistory.value.every((i) => getEffectiveTotal(i) === 0),
);

// True when the user has any venture activity reflected in the loaded series.
// Gates the venture tooltip row and the venture option in the balance-type
// selector — both must stay hidden for users with no venture deals.
const hasVentureData = computed(
  () => !!balanceHistory.value && balanceHistory.value.some((i) => i.venturesBalance !== 0),
);

// Same gating for vehicles — most users don't have any, so the option only
// surfaces once a vehicle account exists.
const hasVehicleData = computed(
  () => !!balanceHistory.value && balanceHistory.value.some((i) => i.vehiclesBalance !== 0),
);

// Same gating for loans; balances are negative, so check `!== 0` (not `> 0`) to detect any active loan.
const hasLoanData = computed(() => !!balanceHistory.value && balanceHistory.value.some((i) => i.loansBalance !== 0));

// Tooltip rows for vehicles/ventures/loans show when the component contributes
// to what the user is currently viewing — either it's flowing into the Total
// (and Total is the selected line), or the user explicitly picked that
// component's line from the dropdown. Hidden when toggled out of Total to
// avoid showing a value that doesn't add up to the displayed Total.
const showVehiclesRow = computed(() => {
  if (!hasVehicleData.value) return false;
  if (selectedBalanceType.value.value === 'vehicles') return true;
  return includeVehiclesInTotal.value;
});
const showVenturesRow = computed(() => {
  if (!hasVentureData.value) return false;
  if (selectedBalanceType.value.value === 'ventures') return true;
  return includeVenturesInTotal.value;
});
const showLoansRow = computed(() => {
  if (!hasLoanData.value) return false;
  if (selectedBalanceType.value.value === 'loans') return true;
  return includeLoansInTotal.value;
});

const tooltipCurrency = computed(() => baseCurrency.value?.currency?.code);
const formatTooltipMoney = (value: number) =>
  formatLargeNumber(value, { isFiat: true, currency: tooltipCurrency.value });
const deltaColorClass = (delta: number) => ({
  'text-success-text': delta > 0,
  'text-app-expense-color': delta < 0,
  'text-card-tooltip-muted': delta === 0,
});

// Component breakdown shown in the tooltip, gated the same way as the standalone
// row flags so the visible deltas always sum to the displayed Total.
const tooltipComponentRows = computed(() =>
  [
    {
      key: 'accounts',
      label: t('dashboard.widgets.balanceTrend.tooltip.accounts'),
      value: tooltip.accountsBalance,
      delta: tooltip.accountsDelta,
      show: true,
    },
    {
      key: 'portfolios',
      label: t('dashboard.widgets.balanceTrend.tooltip.portfolios'),
      value: tooltip.portfoliosBalance,
      delta: tooltip.portfoliosDelta,
      show: true,
    },
    {
      key: 'ventures',
      label: t('dashboard.widgets.balanceTrend.tooltip.ventures'),
      value: tooltip.venturesBalance,
      delta: tooltip.venturesDelta,
      show: showVenturesRow.value,
    },
    {
      key: 'vehicles',
      label: t('dashboard.widgets.balanceTrend.tooltip.vehicles'),
      value: tooltip.vehiclesBalance,
      delta: tooltip.vehiclesDelta,
      show: showVehiclesRow.value,
    },
    {
      key: 'loans',
      label: t('dashboard.widgets.balanceTrend.tooltip.loans'),
      value: tooltip.loansBalance,
      delta: tooltip.loansDelta,
      show: showLoansRow.value,
    },
  ].filter((row) => row.show),
);

const balanceTypeOptions = computed<BalanceTypeOption[]>(() => {
  const options: BalanceTypeOption[] = [
    { value: 'total', label: t('dashboard.widgets.balanceTrend.balanceTypes.total') },
    { value: 'accounts', label: t('dashboard.widgets.balanceTrend.balanceTypes.accounts') },
    { value: 'portfolios', label: t('dashboard.widgets.balanceTrend.balanceTypes.portfolios') },
  ];
  if (hasVentureData.value) {
    options.push({ value: 'ventures', label: t('dashboard.widgets.balanceTrend.balanceTypes.ventures') });
  }
  if (hasVehicleData.value) {
    options.push({ value: 'vehicles', label: t('dashboard.widgets.balanceTrend.balanceTypes.vehicles') });
  }
  if (hasLoanData.value) {
    options.push({ value: 'loans', label: t('dashboard.widgets.balanceTrend.balanceTypes.loans') });
  }
  return options;
});

// Roll the user off the ventures/vehicles/loans views if the underlying data
// disappears (last deal/vehicle/loan deleted while widget mounted) — otherwise
// the select would display a stale label after the option vanishes from the list.
watch(hasVentureData, (val) => {
  if (!val && selectedBalanceType.value.value === 'ventures') {
    selectedBalanceType.value = balanceTypeOptions.value[0]!;
  }
});
watch(hasVehicleData, (val) => {
  if (!val && selectedBalanceType.value.value === 'vehicles') {
    selectedBalanceType.value = balanceTypeOptions.value[0]!;
  }
});
watch(hasLoanData, (val) => {
  if (!val && selectedBalanceType.value.value === 'loans') {
    selectedBalanceType.value = balanceTypeOptions.value[0]!;
  }
});

const periodLabel = computed(() => {
  const from = props.selectedPeriod.from;
  const to = props.selectedPeriod.to;
  const now = new Date();

  // Current month - show "Today"
  if (isSameMonth(now, to) && isSameMonth(from, to)) {
    return t('dashboard.widgets.balanceTrend.today');
  }

  // Specific month (not current) - show "November 2025"
  if (isSameMonth(from, to)) {
    return format(to, 'MMMM yyyy');
  }

  // Check if it's a month-aligned range (starts on 1st day, ends on last day of month)
  const isFromMonthStart = from.getDate() === 1;
  const endOfToMonth = new Date(to.getFullYear(), to.getMonth() + 1, 0);
  const isToMonthEnd = to.getDate() === endOfToMonth.getDate();

  if (isFromMonthStart && isToMonthEnd) {
    // Multi-month range like "Aug 2025 - Nov 2025"
    return `${format(from, 'MMM yyyy')} - ${format(to, 'MMM yyyy')}`;
  }

  // Custom date range - show "MMM d, yyyy - MMM d, yyyy"
  return `${format(from, 'MMM d, yyyy')} - ${format(to, 'MMM d, yyyy')}`;
});

// Chart data based on selected balance type
const chartData = computed(() => {
  if (!balanceHistory.value) return [];

  return balanceHistory.value.map((point) => {
    const effectiveTotal = getEffectiveTotal(point);

    let value: number;
    switch (selectedBalanceType.value.value) {
      case 'accounts':
        value = point.accountsBalance;
        break;
      case 'portfolios':
        value = point.portfoliosBalance;
        break;
      case 'ventures':
        value = point.venturesBalance;
        break;
      case 'vehicles':
        value = point.vehiclesBalance;
        break;
      case 'loans':
        value = point.loansBalance;
        break;
      default:
        value = effectiveTotal;
    }

    return {
      date: startOfDay(new Date(point.date)).getTime(),
      value,
      accountsBalance: point.accountsBalance,
      portfoliosBalance: point.portfoliosBalance,
      venturesBalance: point.venturesBalance,
      vehiclesBalance: point.vehiclesBalance,
      loansBalance: point.loansBalance,
      totalBalance: effectiveTotal,
    };
  });
});

const { spikePoints } = useSpikeDetection({ chartData, options: spikeSettings });

// Plans only ever sit on money accounts, so the projection continues the accounts line
// and the total line; the other balance types have nothing pending to add.
const isProjectionEligible = computed(
  () => selectedBalanceType.value.value === 'total' || selectedBalanceType.value.value === 'accounts',
);
const isPeriodEndCurrentOrFuture = computed(
  () => startOfDay(props.selectedPeriod.to).getTime() >= startOfDay(new Date()).getTime(),
);

// The widget previews where the period lands, not every plan, so it reads a bounded slice.
// The endpoint orders by time DESC by default; ascending order is what makes the truncated
// slice the nearest plans instead of the furthest-out ones.
const PENDING_PLANS_LIMIT = 30;

const { data: pendingPlans } = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.widgetBalanceTrendPlanned, periodQueryKey, includePlanned],
  queryFn: () =>
    loadTransactions({
      isPlanned: true,
      offset: 0,
      limit: PENDING_PLANS_LIMIT,
      order: SORT_DIRECTIONS.asc,
      to: endOfDay(props.selectedPeriod.to).toISOString(),
    }),
  staleTime: Infinity,
  placeholderData: (prevData) => prevData,
  enabled: computed(() => includePlanned.value && isPeriodEndCurrentOrFuture.value),
});

// The plans endpoint spans every account the user owns, archived included, while the chart's
// lines are built from the projected-total scope — a plan outside it would move the dashed
// line without ever having moved the solid one.
const projectionAccountIds = computed(
  () => new Set(selectProjectedTotalAccounts({ accounts: accounts.value ?? [] }).map((account) => account.id)),
);

const projection = computed<BalanceProjection | null>(() => {
  if (!includePlanned.value || !isProjectionEligible.value) return null;
  if (!pendingPlans.value || pendingPlans.value.length === 0) return null;

  const lastChartPoint = chartData.value[chartData.value.length - 1];
  if (!lastChartPoint) return null;

  const scopedPlans = pendingPlans.value.filter((tx) => projectionAccountIds.value.has(tx.accountId));
  if (scopedPlans.length === 0) return null;

  return buildBalanceProjection({
    lastRealPoint: { date: lastChartPoint.date, value: lastChartPoint.value },
    plans: scopedPlans.map((tx) => ({
      time: tx.time,
      refAmount: tx.refAmount,
      transactionType: tx.transactionType,
      note: tx.note,
    })),
    periodEnd: startOfDay(actualDataPeriod.value.to).getTime(),
    now: Date.now(),
  });
});

const { formatPlannedDate } = usePlannedDateLabel();
const projectionThroughDate = computed(() => formatPlannedDate({ time: projection.value?.latestPlanTime ?? null }));

// End date the chart x-axis should reach. Trimmed to today when fitToLatestData is on —
// unless a projection is drawn, whose dashed tail through the period end is itself the
// latest data the axis has to fit.
const chartXAxisEnd = computed(() => {
  if (!fitToLatestData.value || projection.value) return actualDataPeriod.value.to;
  return min([actualDataPeriod.value.to, new Date()]);
});

// Key for the chart component - changes when period changes to trigger CSS transition
const chartKey = computed(() => `${actualDataPeriod.value.from.getTime()}-${chartXAxisEnd.value.getTime()}`);

const isPortfolioMode = computed(() => selectedBalanceType.value.value === 'portfolios');

// Spike panel state
const router = useRouter();
const spikePanelRef = ref<InstanceType<typeof SpikeTransactionsPanel> | null>(null);

const spikePanel = reactive({
  visible: false,
  x: 0,
  y: 0,
  spikePoint: null as SpikePoint | null,
  accountsDelta: 0,
  portfoliosDelta: 0,
});

const spikeDateLabel = computed(() => {
  if (!spikePanel.spikePoint) return '';
  return format(spikePanel.spikePoint.date, 'MMM d, yyyy');
});

const selectedSpikeDate = ref<string | null>(null);

const { data: spikeTransactions, isLoading: isSpikeTransactionsLoading } = useQuery({
  queryKey: ['spike-transactions', selectedSpikeDate],
  queryFn: async () => {
    if (!selectedSpikeDate.value) return [];
    const dateStart = startOfDay(new Date(selectedSpikeDate.value));
    const dateEnd = endOfDay(new Date(selectedSpikeDate.value));
    const transactions = await loadTransactions({
      offset: 0,
      limit: 20,
      from: dateStart.toISOString(),
      to: dateEnd.toISOString(),
    });
    // Sort by highest refAmount (base currency) so the biggest transactions show first
    return transactions.sort((a, b) => Math.abs(b.refAmount) - Math.abs(a.refAmount));
  },
  enabled: computed(() => selectedSpikeDate.value !== null),
  staleTime: Infinity,
});

function openSpikePanel({ event, spike }: { event: MouseEvent; spike: SpikePoint }) {
  const PANEL_WIDTH = 338;
  const PANEL_HEIGHT_ESTIMATE = 250;
  const MARGIN = 12;

  let x = event.clientX + MARGIN;
  let y = event.clientY + MARGIN;

  // Viewport boundary checks
  if (x + PANEL_WIDTH > window.innerWidth) {
    x = event.clientX - PANEL_WIDTH - MARGIN;
  }
  if (x < MARGIN) x = MARGIN;

  if (y + PANEL_HEIGHT_ESTIMATE > window.innerHeight) {
    y = event.clientY - PANEL_HEIGHT_ESTIMATE - MARGIN;
  }
  if (y < MARGIN) y = MARGIN;

  spikePanel.x = x;
  spikePanel.y = y;
  spikePanel.spikePoint = spike;

  // Compute per-component deltas from chartData
  const spikeIndex = chartData.value.findIndex((d) => d.date === spike.date);
  if (spikeIndex > 0) {
    const curr = chartData.value[spikeIndex]!;
    const prev = chartData.value[spikeIndex - 1]!;
    spikePanel.accountsDelta = curr.accountsBalance - prev.accountsBalance;
    spikePanel.portfoliosDelta = curr.portfoliosBalance - prev.portfoliosBalance;
  } else {
    spikePanel.accountsDelta = 0;
    spikePanel.portfoliosDelta = 0;
  }

  spikePanel.visible = true;

  // Trigger transaction fetch by setting the date
  selectedSpikeDate.value = format(spike.date, 'yyyy-MM-dd');
}

function closeSpikePanel() {
  spikePanel.visible = false;
  spikePanel.spikePoint = null;
  spikePanel.accountsDelta = 0;
  spikePanel.portfoliosDelta = 0;
  selectedSpikeDate.value = null;
}

function navigateToSpikeTransactions() {
  if (!spikePanel.spikePoint) return;
  const dateStr = format(new Date(spikePanel.spikePoint.date), 'yyyy-MM-dd');

  router.push({
    name: ROUTES_NAMES.transactions,
    query: { start: dateStr, end: dateStr },
  });
}

// Close spike panel on click outside
function handleDocumentClick(event: MouseEvent) {
  if (!spikePanel.visible) return;
  const target = event.target as Element;
  // Ignore clicks on spike markers — they have their own handler
  if (target.classList?.contains('spike-hit-area') || target.classList?.contains('spike-dot')) return;
  const panelEl = spikePanelRef.value?.panelRef;
  if (panelEl && !panelEl.contains(target)) {
    closeSpikePanel();
  }
}

function handleEscapeKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && spikePanel.visible) {
    closeSpikePanel();
  }
}

onMounted(() => {
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('keydown', handleEscapeKey);
});

onUnmounted(() => {
  document.removeEventListener('click', handleDocumentClick);
  document.removeEventListener('keydown', handleEscapeKey);
});

const getColors = () => {
  const { grid, text, primary } = getChartColors();
  return { grid, text, primary };
};

const formatAxisValue = (value: number) => formatAxisCurrency({ value, symbol: getCurrencySymbol() });

const renderChart = () => {
  if (!svgRef.value || !containerRef.value || chartData.value.length === 0) return;

  const colors = getColors();
  const svg = d3.select(svgRef.value);
  svg.selectAll('*').remove();

  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  const isMobile = width < 500;

  // Increased margins: more space at bottom for x-axis, right for last label
  const margin = {
    top: 10,
    right: isMobile ? 30 : 40,
    bottom: 35,
    left: isMobile ? 40 : 48,
  };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // Calculate x-axis ticks - limit to 6-7 max
  const pixelsPerTick = isMobile ? 80 : 120;
  const ticksAmount = Math.min(7, Math.max(2, Math.round(innerWidth / pixelsPerTick)));
  const fromDate = actualDataPeriod.value.from;
  const toDate = chartXAxisEnd.value;
  const xAxisTicks = generateDateSteps({ datesToShow: ticksAmount, fromDate, toDate });

  // X scale
  const xScale = d3
    .scaleLinear()
    .domain([xAxisTicks[0]!, xAxisTicks[xAxisTicks.length - 1]!])
    .range([0, innerWidth]);

  // Y scale - limit to 5 ticks. Projected points count as data: a projection landing
  // above the real maximum must not exit the plot.
  const yValues = [...chartData.value.map((d) => d.value), ...(projection.value?.points.map((p) => p.value) ?? [])];
  const yMin = d3.min(yValues) || 0;
  const yMax = d3.max(yValues) || 0;
  const yPadding = (yMax - yMin) * 0.1 || 1000;
  const yScale = d3
    .scaleLinear()
    .domain([yMin - yPadding, yMax + yPadding])
    .nice(5)
    .range([innerHeight, 0]);

  // Calculate exactly 5 tick values
  const yDomain = yScale.domain();
  const yTickCount = 5;
  const yTickStep = (yDomain[1]! - yDomain[0]!) / (yTickCount - 1);
  const yTickValues = Array.from({ length: yTickCount }, (_, i) => yDomain[0]! + i * yTickStep);

  // Grid lines - exactly 5 ticks
  g.append('g')
    .attr('class', 'grid')
    .call(
      d3
        .axisLeft(yScale)
        .tickValues(yTickValues)
        .tickSize(-innerWidth)
        .tickFormat(() => ''),
    )
    .call((grid) => {
      grid.select('.domain').remove();
      grid.selectAll('.tick line').attr('stroke', colors.grid).attr('stroke-opacity', 0.4);
    });

  // Create gradient for area fill
  const gradientId = `area-gradient-${chartKey.value}`;
  const defs = svg.append('defs');
  const gradient = defs
    .append('linearGradient')
    .attr('id', gradientId)
    .attr('x1', '0%')
    .attr('y1', '0%')
    .attr('x2', '0%')
    .attr('y2', '100%');

  gradient.append('stop').attr('offset', '0%').attr('stop-color', 'var(--primary)').attr('stop-opacity', 0.35);

  gradient.append('stop').attr('offset', '100%').attr('stop-color', 'var(--primary)').attr('stop-opacity', 0);

  // Area generator
  const area = d3
    .area<(typeof chartData.value)[0]>()
    .x((d) => xScale(d.date))
    .y0(innerHeight)
    .y1((d) => yScale(d.value))
    .curve(d3.curveMonotoneX);

  // Line generator
  const line = d3
    .line<(typeof chartData.value)[0]>()
    .x((d) => xScale(d.date))
    .y((d) => yScale(d.value))
    .curve(d3.curveMonotoneX);

  // Draw area
  g.append('path').datum(chartData.value).attr('class', 'area').attr('fill', `url(#${gradientId})`).attr('d', area);

  // Draw line
  g.append('path')
    .datum(chartData.value)
    .attr('class', 'line')
    .attr('fill', 'none')
    .attr('stroke', 'var(--primary)')
    .attr('stroke-width', 2)
    .attr('d', line);

  // X axis with tick indicators
  g.append('g')
    .attr('class', 'x-axis')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom(xScale)
        .tickValues(xAxisTicks)
        .tickSize(6)
        .tickFormat((d) => {
          const date = new Date(d as number);
          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }),
    )
    .call((axis) => {
      axis.select('.domain').attr('stroke', colors.grid).attr('stroke-opacity', 0.4);
      axis.selectAll('.tick line').attr('stroke', colors.grid).attr('stroke-opacity', 0.4);
      axis.selectAll('.tick text').attr('fill', colors.text).attr('font-size', '11px').attr('dy', '1em');
    });

  // Y axis - exactly 5 ticks using same values as grid
  g.append('g')
    .attr('class', 'y-axis')
    .call(
      d3
        .axisLeft(yScale)
        .tickValues(yTickValues)
        .tickFormat((d) => formatAxisValue(d as number)),
    )
    .call((axis) => {
      axis.select('.domain').remove();
      axis.selectAll('.tick line').remove();
      axis.selectAll('.tick text').attr('fill', colors.text).attr('font-size', '11px').attr('dx', '-0.3em');
    });

  // Invisible overlay for mouse tracking
  const bisect = d3.bisector<(typeof chartData.value)[0], number>((d) => d.date).left;

  // Hover dot (hidden by default)
  const hoverDot = g
    .append('circle')
    .attr('class', 'hover-dot')
    .attr('r', 5)
    .attr('fill', 'var(--primary)')
    .attr('stroke', 'var(--card)')
    .attr('stroke-width', 2)
    .style('opacity', 0);

  // Vertical line (hidden by default)
  const hoverLine = g
    .append('line')
    .attr('class', 'hover-line')
    .attr('stroke', 'var(--primary)')
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '4,4')
    .attr('y1', 0)
    .attr('y2', innerHeight)
    .style('opacity', 0);

  g.append('rect')
    .attr('class', 'overlay')
    .attr('width', innerWidth)
    .attr('height', innerHeight)
    .attr('fill', 'transparent')
    .attr('cursor', 'crosshair')
    .on('mouseenter', () => {
      hoverDot.style('opacity', 1);
      hoverLine.style('opacity', 0.5);
    })
    .on('mousemove', (event: MouseEvent) => {
      const [mouseX] = d3.pointer(event);
      const x0 = xScale.invert(mouseX);
      const index = bisect(chartData.value, x0, 1);
      const d0 = chartData.value[index - 1];
      const d1 = chartData.value[index];

      if (!d0) return;

      const isCloserToD1 = d1 && x0 - d0.date > d1.date - x0;
      const d = isCloserToD1 ? d1 : d0;
      const currentIndex = isCloserToD1 ? index : index - 1;

      // Update hover dot position
      hoverDot.attr('cx', xScale(d.date)).attr('cy', yScale(d.value));

      // Update hover line position
      hoverLine.attr('x1', xScale(d.date)).attr('x2', xScale(d.date));

      // Update tooltip
      tooltip.date = new Date(d.date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      tooltip.accountsBalance = d.accountsBalance;
      tooltip.portfoliosBalance = d.portfoliosBalance;
      tooltip.venturesBalance = d.venturesBalance;
      tooltip.vehiclesBalance = d.vehiclesBalance;
      tooltip.loansBalance = d.loansBalance;
      tooltip.totalBalance = d.totalBalance;

      // Compute point-over-point deltas (charted line + each component)
      if (currentIndex > 0) {
        const prevPoint = chartData.value[currentIndex - 1]!;
        tooltip.deltaAbsolute = d.value - prevPoint.value;
        tooltip.deltaPercent =
          prevPoint.value !== 0 ? ((d.value - prevPoint.value) / Math.abs(prevPoint.value)) * 100 : 0;
        tooltip.accountsDelta = d.accountsBalance - prevPoint.accountsBalance;
        tooltip.portfoliosDelta = d.portfoliosBalance - prevPoint.portfoliosBalance;
        tooltip.venturesDelta = d.venturesBalance - prevPoint.venturesBalance;
        tooltip.vehiclesDelta = d.vehiclesBalance - prevPoint.vehiclesBalance;
        tooltip.loansDelta = d.loansBalance - prevPoint.loansBalance;
        tooltip.hasDelta = true;
      } else {
        tooltip.deltaAbsolute = 0;
        tooltip.deltaPercent = 0;
        tooltip.accountsDelta = 0;
        tooltip.portfoliosDelta = 0;
        tooltip.venturesDelta = 0;
        tooltip.vehiclesDelta = 0;
        tooltip.loansDelta = 0;
        tooltip.hasDelta = false;
      }

      tooltip.visible = true;

      updateTooltipPosition(event);
    })
    .on('mouseleave', () => {
      tooltip.visible = false;
      hoverDot.style('opacity', 0);
      hoverLine.style('opacity', 0);
    });

  // Spike markers — appended after overlay so they sit on top in SVG z-order
  const markerRadius = isMobile ? 5 : 6;
  const hitAreaRadius = markerRadius + 12;
  const markers = g.append('g').attr('class', 'spike-markers');

  // Invisible hit areas (larger click target)
  markers
    .selectAll('.spike-hit-area')
    .data(spikePoints.value)
    .join('circle')
    .attr('class', 'spike-hit-area')
    .attr('cx', (d) => xScale(d.date))
    .attr('cy', (d) => yScale(d.value))
    .attr('r', hitAreaRadius)
    .attr('fill', 'transparent')
    .attr('cursor', 'pointer')
    .on('click', (event: MouseEvent, d) => {
      event.stopPropagation();
      openSpikePanel({ event, spike: d });
    });

  // Visible markers
  markers
    .selectAll('.spike-dot')
    .data(spikePoints.value)
    .join('circle')
    .attr('class', 'spike-dot')
    .attr('cx', (d) => xScale(d.date))
    .attr('cy', (d) => yScale(d.value))
    .attr('r', markerRadius)
    .attr('fill', (d) => (d.isPositive ? 'var(--color-app-income-color)' : 'var(--color-app-expense-color)'))
    .attr('stroke', 'var(--card)')
    .attr('stroke-width', 2)
    .attr('cursor', 'pointer')
    .attr('pointer-events', 'none')
    .style('filter', 'drop-shadow(0 0 3px rgba(0,0,0,0.3))');

  // Projected continuation: dashed step-line from the last real point, one hollow dot
  // per plan date, holding the final level to the period end.
  if (projection.value) {
    const projectionGroup = g.append('g').attr('class', 'projection');

    const todayTs = startOfDay(new Date()).getTime();
    const [domainStart, domainEnd] = xScale.domain() as [number, number];
    if (todayTs >= domainStart && todayTs < domainEnd) {
      projectionGroup
        .append('line')
        .attr('x1', xScale(todayTs))
        .attr('x2', xScale(todayTs))
        .attr('y1', 0)
        .attr('y2', innerHeight)
        .attr('stroke', colors.grid)
        .attr('stroke-opacity', 0.6)
        .attr('stroke-dasharray', '2,3');
    }

    const projectionLine = d3
      .line<{ date: number; value: number }>()
      .x((d) => xScale(d.date))
      .y((d) => yScale(d.value))
      .curve(d3.curveStepAfter);

    projectionGroup
      .append('path')
      .datum(projection.value.points)
      .attr('fill', 'none')
      .attr('stroke', 'var(--primary)')
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.85)
      .attr('stroke-dasharray', '5,4')
      .attr('d', projectionLine);

    projectionGroup
      .selectAll('.projection-dot')
      .data(projection.value.steps)
      .join('circle')
      .attr('class', 'projection-dot')
      .attr('cx', (d) => xScale(d.date))
      .attr('cy', (d) => yScale(d.value))
      .attr('r', 3.5)
      .attr('fill', 'var(--card)')
      .attr('stroke', 'var(--primary)')
      .attr('stroke-width', 1.5)
      .append('title')
      .text((d) =>
        d.planLabels
          .map((plan) => {
            const amount =
              plan.refDelta > 0 ? `+${formatBaseCurrency(plan.refDelta)}` : formatBaseCurrency(plan.refDelta);
            return plan.note ? `${amount} · ${plan.note}` : amount;
          })
          .join('\n'),
      );
  }
};

const displayBalance = computed(() => {
  if (!balanceHistory.value || balanceHistory.value.length === 0) return { current: 0, previous: 0 };

  // Get the latest balance entry from current period
  const latestEntry = balanceHistory.value[balanceHistory.value.length - 1]!;

  // Get the latest (ending) balance from previous period for comparison
  const prevPeriodLastEntry =
    prevPeriodBalance.value && prevPeriodBalance.value.length > 0
      ? prevPeriodBalance.value[prevPeriodBalance.value.length - 1]
      : null;

  switch (selectedBalanceType.value!.value) {
    case 'accounts':
      return {
        current: latestEntry.accountsBalance || 0,
        previous: prevPeriodLastEntry?.accountsBalance || 0,
      };
    case 'portfolios':
      return {
        current: latestEntry.portfoliosBalance || 0,
        previous: prevPeriodLastEntry?.portfoliosBalance || 0,
      };
    case 'ventures':
      return {
        current: latestEntry.venturesBalance || 0,
        previous: prevPeriodLastEntry?.venturesBalance || 0,
      };
    case 'vehicles':
      return {
        current: latestEntry.vehiclesBalance || 0,
        previous: prevPeriodLastEntry?.vehiclesBalance || 0,
      };
    case 'loans':
      return {
        current: latestEntry.loansBalance || 0,
        previous: prevPeriodLastEntry?.loansBalance || 0,
      };
    case 'total':
    default:
      return {
        current: getEffectiveTotal(latestEntry),
        previous: prevPeriodLastEntry ? getEffectiveTotal(prevPeriodLastEntry) : 0,
      };
  }
});

const { displayValue: animatedBalance } = useAnimatedNumber({
  value: computed(() => displayBalance.value.current),
});

const balancesDiff = computed<number>(() => {
  if (!displayBalance.value.current || !displayBalance.value.previous) return 0;

  const percentage = Number(
    calculatePercentageDifference(displayBalance.value.current, displayBalance.value.previous),
  ).toFixed(2);
  return Number(percentage);
});

// Absolute change vs the previous period, shown next to the percentage so the
// headline conveys how much money moved, not just the ratio. Guarded the same
// way as balancesDiff so the amount and the percentage always agree on whether
// a comparison is available.
const balancesDiffAbsolute = computed<number>(() => {
  if (!displayBalance.value.current || !displayBalance.value.previous) return 0;
  return displayBalance.value.current - displayBalance.value.previous;
});

useResizeObserver(containerRef, renderChart);

// flush: 'post' so the watcher runs after Vue has applied DOM updates from the
// new data, then renderChart can read the correct container dimensions.
watch(
  [chartData, () => actualDataPeriod.value, currentTheme],
  () => {
    closeSpikePanel();
    renderChart();
  },
  { deep: true, flush: 'post' },
);

watch([spikePoints, chartXAxisEnd, projection], () => {
  renderChart();
});
</script>

<style scoped>
.chart-fade-enter-active,
.chart-fade-leave-active {
  transition: opacity 0.2s ease;
}

.chart-fade-enter-from,
.chart-fade-leave-to {
  opacity: 0;
}
</style>
