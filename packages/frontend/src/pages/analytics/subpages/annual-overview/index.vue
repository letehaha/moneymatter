<template>
  <div class="@container/trends space-y-6">
    <div class="flex flex-wrap items-center gap-4">
      <PeriodSelector v-model="selectedPeriod" class="max-xs:mx-auto" />
      <MetricToggle v-model="selectedMetric" />
      <FiltersButton
        :label="t('analytics.trends.filters.button')"
        :active-count="countActiveFilters({ filters })"
        class="ml-auto"
      >
        <TrendsFiltersPanel :filters="filters" @update:filters="filters = $event" />
      </FiltersButton>
    </div>

    <!-- Error state -->
    <div v-if="cumulativeError" class="flex h-80 items-center justify-center">
      <div class="text-destructive-text">{{ t('analytics.trends.loadError') }}</div>
    </div>

    <!-- Content (with skeleton fallback) -->
    <template v-else>
      <!-- Summary rows (narrow) -->
      <SummaryRows :items="summaryRows" :loading="isLoadingCumulative" class="@md/trends:hidden">
        <template #divider>
          <div v-if="cumulativeData" class="flex items-center gap-2">
            <span class="bg-border h-px min-w-0 flex-1" />
            <span
              :class="
                cn(
                  'bg-muted/60 flex items-center gap-1 rounded-full px-2.5 py-0.5 text-center text-xs font-semibold tabular-nums',
                  changeClass,
                )
              "
            >
              <component :is="changeIcon" class="size-3 shrink-0" />
              {{ Math.abs(cumulativeData.percentChange) }}%
              <span class="text-muted-foreground font-medium">{{ t('analytics.trends.vsPreviousPeriod') }}</span>
            </span>
            <span class="bg-border h-px min-w-0 flex-1" />
          </div>
        </template>
      </SummaryRows>

      <!-- Summary Cards (wide) -->
      <div class="hidden grid-cols-3 gap-4 @md/trends:grid">
        <!-- Card 1: Current period -->
        <SummaryCardSkeleton v-if="isLoadingCumulative" title-width="w-20" value-width="w-28" />
        <SummaryCard
          v-else-if="cumulativeData"
          :title="metricLabel"
          :value="cumulativeData.currentPeriod.total"
          :change="cumulativeData.percentChange"
          :comparison-period-label="t('analytics.trends.vsPreviousPeriod')"
          :invert-colors="selectedMetric === 'expenses'"
        />

        <!-- Card 2: Previous period -->
        <SummaryCardSkeleton v-if="isLoadingCumulative" title-width="w-24" value-width="w-28" />
        <SummaryCard
          v-else-if="cumulativeData"
          :title="`${t('analytics.trends.chart.comparisonPeriod')}`"
          :value="cumulativeData.previousPeriod.total"
        />

        <!-- Card 3: Percent change -->
        <SummaryCardSkeleton
          v-if="isLoadingCumulative"
          container-class="flex items-center justify-center"
          inner-class="text-center"
          title-width="w-24 mx-auto"
          value-width="w-16 mx-auto"
        />
        <div
          v-else-if="cumulativeData"
          class="border-border bg-card flex items-center justify-center rounded-lg border p-4"
        >
          <div class="text-center">
            <div class="text-muted-foreground mb-1 text-sm">{{ t('analytics.trends.vsPreviousPeriod') }}</div>
            <div
              :class="[
                'text-2xl font-semibold',
                cumulativeData.percentChange > 0
                  ? selectedMetric === 'expenses'
                    ? 'text-red-500'
                    : 'text-green-500'
                  : cumulativeData.percentChange < 0
                    ? selectedMetric === 'expenses'
                      ? 'text-green-500'
                      : 'text-red-500'
                    : 'text-muted-foreground',
              ]"
            >
              {{ cumulativeData.percentChange > 0 ? '+' : '' }}{{ cumulativeData.percentChange }}%
            </div>
          </div>
        </div>
      </div>

      <!-- Monthly Comparison Chart -->
      <MonthlyComparisonChart
        :from="selectedPeriod.from"
        :to="selectedPeriod.to"
        :metric="selectedMetric"
        :filters="filters"
        @hide-category="filters = hideCategory({ filters, categoryId: $event.categoryId })"
        @show-category="filters = showCategory({ filters, categoryId: $event.categoryId })"
      />

      <!-- Cumulative Chart Skeleton -->
      <ChartSkeleton v-if="isLoadingCumulative" />

      <!-- Cumulative Chart -->
      <template v-else-if="cumulativeData">
        <div
          v-if="cumulativeData.currentPeriod.data.length > 0 || cumulativeData.previousPeriod.data.length > 0"
          class="border-border bg-card rounded-lg border p-4 max-sm:px-0"
        >
          <CumulativeChart
            :current-period-data="cumulativeData.currentPeriod.data"
            :previous-period-data="cumulativeData.previousPeriod.data"
            :metric="selectedMetric"
          />
        </div>

        <!-- Empty state for chart -->
        <div v-else class="border-border bg-card flex h-80 items-center justify-center rounded-lg border p-4">
          <div class="text-center">
            <div class="text-muted-foreground">{{ t('analytics.trends.noData') }}</div>
            <div class="text-muted-foreground mt-1 text-sm">{{ t('analytics.trends.noDataHint') }}</div>
          </div>
        </div>
      </template>
    </template>

    <!-- Category Breakdown (show for expenses and income, not savings) -->
    <CategoryBreakdown
      v-if="selectedMetric !== 'savings'"
      :current-period-data="currentPeriodCategories || {}"
      :previous-period-data="previousPeriodCategories || {}"
      :is-loading="isLoadingCategories"
      :is-income="selectedMetric === 'income'"
    />
  </div>
</template>

<script setup lang="ts">
import { buildPeriodChatContext } from '@/composable/chat/period-context';
import { provideChatPageContext } from '@/composable/chat/use-chat-page-context';
import { getCumulativeData, getSpendingsByCategories } from '@/api';
import { QUERY_CACHE_STALE_TIME, VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useFormatCurrency } from '@/composable';
import { useChartColors } from '@/composable/charts/chart-colors';
import { cn } from '@/lib/utils';
import { TRANSACTION_TYPES } from '@bt/shared/types';
import { ArrowDownIcon, ArrowUpIcon, MinusIcon } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { useSessionStorage } from '@vueuse/core';
import { differenceInMonths, startOfMonth, subMonths } from 'date-fns';
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import { createPeriodSerializer } from '../../utils';
import ChartSkeleton from '../cash-flow/components/chart-skeleton.vue';
import type { Period } from '@/composable/use-period-navigation';
import PeriodSelector from '../cash-flow/components/period-selector.vue';
import SummaryCardSkeleton from '../cash-flow/components/summary-card-skeleton.vue';
import SummaryCard from '../cash-flow/components/summary-card.vue';
import CategoryBreakdown from './components/category-breakdown.vue';
import CumulativeChart from './components/cumulative-chart.vue';
import MetricToggle, { type MetricType } from './components/metric-toggle.vue';
import MonthlyComparisonChart from './components/monthly-comparison-chart.vue';
import TrendsFiltersPanel from './components/trends-filters-panel.vue';
import FiltersButton from '../../components/filters-button.vue';
import SummaryRows, { type SummaryRowItem } from '../../components/summary-rows.vue';
import {
  type TrendsFilters,
  countActiveFilters,
  emptyTrendsFilters,
  hideCategory,
  parseTrendsFilters,
  showCategory,
  toStatsFilterParams,
} from './trends-filters';

const { t } = useI18n();
const { formatBaseCurrency } = useFormatCurrency();
const colors = useChartColors();
const route = useRoute();

const router = useRouter();

// Helper to get default period
const getDefaultPeriod = (): Period => ({
  from: subMonths(new Date(), 12),
  to: new Date(),
});

const periodSerializer = createPeriodSerializer({ getDefaultPeriod });

// State with session persistence using VueUse
const selectedPeriod = useSessionStorage<Period>('trends-comparison-period', getDefaultPeriod(), {
  serializer: periodSerializer,
});

provideChatPageContext(() => buildPeriodChatContext({ period: selectedPeriod.value }));
const selectedMetric = useSessionStorage<MetricType>('trends-comparison-metric', 'expenses');
const filters = useSessionStorage<TrendsFilters>('trends-comparison-filters', emptyTrendsFilters(), {
  serializer: { read: (raw) => parseTrendsFilters({ raw }), write: (value) => JSON.stringify(value) },
});

// A `?categoryIds=` deep link preselects categories, then is consumed.
onMounted(() => {
  const queryValue = route.query.categoryIds;
  if (!queryValue) return;

  const categoryIds = (Array.isArray(queryValue) ? queryValue : [queryValue]).filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );

  if (categoryIds.length > 0) {
    filters.value = { ...filters.value, categories: { mode: 'include', ids: categoryIds } };
  }

  // Replace rather than push so back-navigation still leaves the page.
  const { categoryIds: _consumed, ...restQuery } = route.query;
  router.replace({ query: restQuery });
});

const statsFilterParams = computed(() => toStatsFilterParams({ filters: filters.value }));

// Computed metric label
const metricLabel = computed(() => {
  const labels = {
    expenses: t('analytics.trends.metrics.expenses'),
    income: t('analytics.trends.metrics.income'),
    savings: t('analytics.trends.metrics.savings'),
  };
  return labels[selectedMetric.value];
});

// Query params
const cumulativeQueryParams = computed(() => ({
  from: selectedPeriod.value.from,
  to: selectedPeriod.value.to,
  metric: selectedMetric.value,
  ...statsFilterParams.value,
}));

// Cumulative data query
const {
  data: cumulativeData,
  isLoading: isLoadingCumulative,
  error: cumulativeError,
} = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.analyticsCumulative, cumulativeQueryParams],
  queryFn: () => getCumulativeData(cumulativeQueryParams.value),
  staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
  gcTime: QUERY_CACHE_STALE_TIME.ANALYTICS * 2,
});

const summaryRows = computed<SummaryRowItem[]>(() => {
  if (!cumulativeData.value) return [];
  const metricColor = {
    expenses: colors.value.appExpense,
    income: colors.value.appIncome,
    savings: colors.value.appSavings,
  }[selectedMetric.value];
  return [
    {
      label: metricLabel.value,
      value: formatBaseCurrency(cumulativeData.value.currentPeriod.total),
      color: metricColor,
    },
    {
      label: t('analytics.trends.chart.comparisonPeriod'),
      value: formatBaseCurrency(cumulativeData.value.previousPeriod.total),
      color: colors.value.text,
      valueClass: 'text-muted-foreground font-semibold',
    },
  ];
});

const changeIcon = computed(() => {
  const change = cumulativeData.value?.percentChange ?? 0;
  return change === 0 ? MinusIcon : change > 0 ? ArrowUpIcon : ArrowDownIcon;
});

const changeClass = computed(() => {
  const change = cumulativeData.value?.percentChange ?? 0;
  if (change === 0) return 'text-muted-foreground';
  const isGood = selectedMetric.value === 'expenses' ? change < 0 : change > 0;
  return isGood ? 'text-app-income-color' : 'text-app-expense-color';
});

// Category breakdown queries (for expenses and income, not savings)
const categoryType = computed(() =>
  selectedMetric.value === TRANSACTION_TYPES.income ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense,
);

const currentPeriodDates = computed(() => ({
  from: selectedPeriod.value.from,
  to: selectedPeriod.value.to,
  type: categoryType.value,
  ...statsFilterParams.value,
}));

// Calculate period length and get the immediately preceding period (same as cumulative chart)
const periodLengthMonths = computed(
  () => differenceInMonths(startOfMonth(selectedPeriod.value.to), startOfMonth(selectedPeriod.value.from)) + 1,
);

const previousPeriodDates = computed(() => ({
  from: subMonths(selectedPeriod.value.from, periodLengthMonths.value),
  to: subMonths(selectedPeriod.value.to, periodLengthMonths.value),
  type: categoryType.value,
  ...statsFilterParams.value,
}));

const { data: currentPeriodCategories, isLoading: isLoadingCurrentCategories } = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.analyticsSpendingsByCategories, 'current', cumulativeQueryParams],
  queryFn: () => getSpendingsByCategories(currentPeriodDates.value),
  staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
  gcTime: QUERY_CACHE_STALE_TIME.ANALYTICS * 2,
  enabled: computed(() => selectedMetric.value !== 'savings'),
});

const { data: previousPeriodCategories, isLoading: isLoadingPreviousCategories } = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.analyticsSpendingsByCategories, 'previous', cumulativeQueryParams],
  queryFn: () => getSpendingsByCategories(previousPeriodDates.value),
  staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
  gcTime: QUERY_CACHE_STALE_TIME.ANALYTICS * 2,
  enabled: computed(() => selectedMetric.value !== 'savings'),
});

const isLoadingCategories = computed(() => isLoadingCurrentCategories.value || isLoadingPreviousCategories.value);
</script>
