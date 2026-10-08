<template>
  <div class="@container/cash-flow space-y-6">
    <ReportControls v-model:period="selectedPeriod">
      <GranularitySelector
        v-model="selectedGranularity"
        :granularities="CASH_FLOW_GRANULARITIES"
        label-key-prefix="analytics.cashFlow.granularity"
      />
      <ChartTypeSwitcher v-model="selectedChartType" />

      <!-- Settings dropdown -->
      <Popover>
        <PopoverTrigger as-child>
          <UiButton variant="secondary" size="icon" :title="t('common.actions.settings')">
            <Settings2Icon class="size-4" />
          </UiButton>
        </PopoverTrigger>
        <PopoverContent align="end" class="w-auto max-w-70">
          <div class="space-y-3">
            <div class="space-y-1">
              <Label class="flex cursor-pointer items-center gap-2 text-sm font-normal">
                <Checkbox v-model="showMovingAverage" />
                {{ t('analytics.cashFlow.showTrendLine') }}
              </Label>
              <p class="text-muted-foreground pl-6 text-xs">
                {{ t('analytics.cashFlow.showTrendLineHint') }}
              </p>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </ReportControls>

    <SummaryRows
      v-if="isLoading || cashFlowData"
      :items="summaryRows"
      :loading="isLoading"
      :skeleton-count="4"
      class="@md/cash-flow:hidden"
    />
    <div v-if="isLoading" class="hidden grid-cols-2 gap-4 md:grid-cols-4 @md/cash-flow:grid">
      <SummaryCardSkeleton v-for="i in 4" :key="i" title-width="w-20" value-width="w-28" />
    </div>
    <div v-else-if="cashFlowData" class="hidden grid-cols-2 gap-4 md:grid-cols-4 @md/cash-flow:grid">
      <SummaryCard
        :title="t('analytics.cashFlow.income')"
        :value="cashFlowData.totals.income"
        :change="trends.income"
        :comparison-period-label="comparisonPeriodLabel"
      />
      <SummaryCard
        :title="t('analytics.cashFlow.expenses')"
        :value="cashFlowData.totals.expenses"
        :change="trends.expenses"
        :comparison-period-label="comparisonPeriodLabel"
      />
      <SummaryCard
        :title="t('analytics.cashFlow.netSavings')"
        :value="cashFlowData.totals.netFlow"
        :change="trends.netFlow"
        :comparison-period-label="comparisonPeriodLabel"
      />
      <SummaryCard
        :title="t('analytics.cashFlow.savingsRate')"
        :value="Math.round(cashFlowData.totals.savingsRate)"
        suffix="%"
        :change="trends.savingsRate"
        :comparison-period-label="comparisonPeriodLabel"
      />
    </div>

    <ChartSkeleton v-if="isLoading" height-class="h-100" />

    <!-- Error state -->
    <div v-else-if="error" class="flex h-100 items-center justify-center">
      <div class="text-destructive-text">{{ t('analytics.cashFlow.loadError') }}</div>
    </div>

    <!-- Chart -->
    <div
      v-else-if="cashFlowData && cashFlowData.periods.length > 0"
      class="border-border bg-card rounded-lg border p-4 max-sm:px-0"
    >
      <CashFlowChart
        :data="cashFlowData.periods"
        :chart-type="selectedChartType"
        :show-moving-average="showMovingAverage"
        :highlighted-period="compositionPeriod"
        @select-period="compositionPeriod = $event"
      />
    </div>

    <!-- Empty state -->
    <div v-else-if="cashFlowData && cashFlowData.periods.length === 0" class="flex h-100 items-center justify-center">
      <div class="text-center">
        <div class="text-muted-foreground">{{ t('analytics.cashFlow.noData') }}</div>
        <div class="text-muted-foreground mt-1 text-sm">{{ t('analytics.cashFlow.noDataHint') }}</div>
      </div>
    </div>

    <MoneyFlowSection v-model:period="compositionPeriod" />
  </div>
</template>

<script setup lang="ts">
import { getCashFlow } from '@/api';
import { QUERY_CACHE_STALE_TIME, VUE_QUERY_CACHE_KEYS } from '@/common/const';
import UiButton from '@/components/lib/ui/button/Button.vue';
import Checkbox from '@/components/lib/ui/checkbox/Checkbox.vue';
import Label from '@/components/lib/ui/label/Label.vue';
import Popover from '@/components/lib/ui/popover/Popover.vue';
import PopoverContent from '@/components/lib/ui/popover/PopoverContent.vue';
import PopoverTrigger from '@/components/lib/ui/popover/PopoverTrigger.vue';
import { useDateLocale } from '@/composable/use-date-locale';
import { endpointsTypes } from '@bt/shared/types';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { useLocalStorage, useSessionStorage } from '@vueuse/core';
import { differenceInDays, endOfMonth, startOfMonth, subDays, subMonths } from 'date-fns';
import { Settings2Icon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFormatCurrency } from '@/composable';
import { useChartColors } from '@/composable/charts/chart-colors';

import { createPeriodSerializer } from '../../utils';
import CashFlowChart from './components/cash-flow-chart.vue';
import ChartSkeleton from './components/chart-skeleton.vue';
import ChartTypeSwitcher, { type ChartType } from './components/chart-type-switcher.vue';
import GranularitySelector from '../../components/granularity-selector.vue';
import ReportControls from '../../components/report-controls.vue';
import type { Period } from '@/composable/use-period-navigation';
import MoneyFlowSection from './components/money-flow-section.vue';
import SummaryCardSkeleton from './components/summary-card-skeleton.vue';
import SummaryCard from './components/summary-card.vue';
import SummaryRows, { type SummaryRowItem } from '../../components/summary-rows.vue';

const { t } = useI18n();
const { formatBaseCurrency } = useFormatCurrency();
const colors = useChartColors();
const { format } = useDateLocale();

// Constants
const DEFAULT_PERIOD_MONTHS = 12;

// Helper to get default period
const getDefaultPeriod = (): Period => ({
  from: startOfMonth(subMonths(new Date(), DEFAULT_PERIOD_MONTHS - 1)),
  to: endOfMonth(new Date()),
});

const periodSerializer = createPeriodSerializer({ getDefaultPeriod });

// State with persistence using VueUse
// localStorage - persists across sessions
const selectedChartType = useLocalStorage<ChartType>('cash-flow-chart-type', 'mirrored');
const { CASH_FLOW_GRANULARITIES } = endpointsTypes;
const selectedGranularity = useLocalStorage<endpointsTypes.CashFlowGranularity>('cash-flow-granularity', 'monthly');

// sessionStorage - clears when tab closes
const selectedPeriod = useSessionStorage<Period>('cash-flow-period', getDefaultPeriod(), {
  serializer: periodSerializer,
});
const showMovingAverage = useSessionStorage('cash-flow-show-moving-avg', true);

const getDefaultCompositionPeriod = (): Period => ({
  from: startOfMonth(new Date()),
  to: endOfMonth(new Date()),
});
const compositionPeriod = useSessionStorage<Period>('cash-flow-composition-period', getDefaultCompositionPeriod(), {
  serializer: createPeriodSerializer({ getDefaultPeriod: getDefaultCompositionPeriod }),
});

// Calculate previous period (same duration, immediately before current period)
const previousPeriod = computed(() => {
  const periodDays = differenceInDays(selectedPeriod.value.to, selectedPeriod.value.from) + 1;
  return {
    from: subDays(selectedPeriod.value.from, periodDays),
    to: subDays(selectedPeriod.value.from, 1),
  };
});

// Format the comparison period label for tooltips
const comparisonPeriodLabel = computed(() => {
  const from = previousPeriod.value.from;
  const to = previousPeriod.value.to;

  // Format: "vs 1 Feb 2024 – 31 Jan 2025 (prev period)"
  const fromStr = format(from, 'd MMM yyyy');
  const toStr = format(to, 'd MMM yyyy');

  return `vs ${fromStr} – ${toStr}`;
});

// Query params for current period
const queryParams = computed(() => ({
  from: selectedPeriod.value.from,
  to: selectedPeriod.value.to,
  granularity: selectedGranularity.value,
}));

// Query params for previous period (for trend comparison)
const previousQueryParams = computed(() => ({
  from: previousPeriod.value.from,
  to: previousPeriod.value.to,
  granularity: selectedGranularity.value,
}));

const {
  data: cashFlowData,
  isLoading,
  error,
} = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.analyticsCashFlow, queryParams],
  queryFn: () => getCashFlow(queryParams.value),
  staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
  gcTime: QUERY_CACHE_STALE_TIME.ANALYTICS * 2,
  placeholderData: keepPreviousData,
});

// Fetch previous period data for trend comparison
const { data: previousCashFlowData } = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.analyticsCashFlow, previousQueryParams],
  queryFn: () => getCashFlow(previousQueryParams.value),
  staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
  gcTime: QUERY_CACHE_STALE_TIME.ANALYTICS * 2,
  placeholderData: keepPreviousData,
});

// Calculate trend (% change between current period totals and previous period totals)
const calculateTrend = ({
  current,
  previous,
}: {
  current: number | undefined;
  previous: number | undefined;
}): number | undefined => {
  if (current === undefined || previous === undefined) return undefined;
  if (previous === 0) return current > 0 ? 100 : current < 0 ? -100 : 0;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
};

const trends = computed(() => {
  const currentTotals = cashFlowData.value?.totals;
  const previousTotals = previousCashFlowData.value?.totals;

  return {
    income: calculateTrend({
      current: currentTotals?.income,
      previous: previousTotals?.income,
    }),
    expenses: calculateTrend({
      current: currentTotals?.expenses,
      previous: previousTotals?.expenses,
    }),
    netFlow: calculateTrend({
      current: currentTotals?.netFlow,
      previous: previousTotals?.netFlow,
    }),
    // Savings rate comparison: difference in percentage points (not % change)
    savingsRate:
      currentTotals?.savingsRate !== undefined && previousTotals?.savingsRate !== undefined
        ? Math.round(currentTotals.savingsRate - previousTotals.savingsRate)
        : undefined,
  };
});

const summaryRows = computed<SummaryRowItem[]>(() => {
  if (!cashFlowData.value) return [];
  const { totals } = cashFlowData.value;
  const label = comparisonPeriodLabel.value;
  return [
    {
      label: t('analytics.cashFlow.income'),
      value: formatBaseCurrency(totals.income),
      change: trends.value.income,
      comparisonPeriodLabel: label,
      color: colors.value.appIncome,
    },
    {
      label: t('analytics.cashFlow.expenses'),
      value: formatBaseCurrency(totals.expenses),
      change: trends.value.expenses,
      comparisonPeriodLabel: label,
      color: colors.value.appExpense,
    },
    {
      label: t('analytics.cashFlow.netSavings'),
      value: formatBaseCurrency(totals.netFlow),
      change: trends.value.netFlow,
      comparisonPeriodLabel: label,
      color: colors.value.appSavings,
    },
    {
      label: t('analytics.cashFlow.savingsRate'),
      value: `${Math.round(totals.savingsRate)}%`,
      change: trends.value.savingsRate,
      comparisonPeriodLabel: label,
      color: colors.value.appSavings,
    },
  ];
});
</script>
