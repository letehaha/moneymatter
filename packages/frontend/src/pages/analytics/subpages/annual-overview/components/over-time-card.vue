<template>
  <div class="border-border bg-card rounded-lg border p-4 @max-[40rem]/trends:px-2">
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2 @max-[40rem]/trends:px-2">
      <h3 class="text-lg font-semibold">{{ t('analytics.trends.overTime.title') }}</h3>
      <div class="flex items-center gap-2">
        <Loader2Icon v-if="isFetching" class="text-muted-foreground size-4 animate-spin" />
        <GranularitySelector
          v-if="chartType === 'monthly'"
          v-model="granularity"
          :granularities="BAR_GRANULARITIES"
          label-key-prefix="analytics.trends.overTime.granularity"
          trigger-class="md:h-10"
        />
        <PillTabs
          :model-value="chartType"
          :items="chartTypeItems"
          @update:model-value="(value) => (chartType = value as ChartType)"
        />
      </div>
    </div>

    <div class="min-h-90">
      <ChartSkeleton v-if="isLoading" />
      <div v-else-if="isError" class="flex h-80 items-center justify-center">
        <div class="text-destructive-text">{{ t('analytics.trends.loadError') }}</div>
      </div>
      <MonthlyComparisonChart
        v-else-if="chartType === 'monthly' && barsData?.periods.length"
        :periods="barsData.periods"
        :metric="metric"
        :filters="filters"
        :colors="colors"
        :selected="selected"
        :detail="detail"
        :granularity="granularity"
        @hide-category="emit('hide-category', $event)"
        @show-category="emit('show-category', $event)"
        @select-period="emit('select-period', $event)"
      />
      <CumulativeChart
        v-else-if="
          chartType === 'cumulative' &&
          (cumulativeData?.currentPeriod.data.length || cumulativeData?.previousPeriod.data.length)
        "
        :current-period-data="cumulativeData.currentPeriod.data"
        :previous-period-data="cumulativeData.previousPeriod.data"
        :metric="metric"
      />
      <div v-else class="flex h-80 items-center justify-center text-center">
        <div>
          <div class="text-muted-foreground">{{ t('analytics.trends.noData') }}</div>
          <div class="text-muted-foreground mt-1 text-sm">{{ t('analytics.trends.noDataHint') }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getCashFlow, getCumulativeData } from '@/api';
import { QUERY_CACHE_STALE_TIME, VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { type PillTabItem, PillTabs } from '@/components/lib/ui/pill-tabs';
import { type Period } from '@/composable/use-period-navigation';
import { useCategoriesStore } from '@/stores';
import { Loader2Icon } from '@lucide/vue';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { useSessionStorage } from '@vueuse/core';
import { endOfMonth, startOfMonth } from 'date-fns';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { createEnumSerializer } from '../../../utils';
import GranularitySelector from '../../../components/granularity-selector.vue';
import ChartSkeleton from '../../cash-flow/components/chart-skeleton.vue';
import { BAR_GRANULARITIES, type BarGranularity, snapToBuckets } from '../group-periods';
import { type MetricType } from '../metric';
import { type TrendsFilters, toStatsFilterParams } from '../trends-filters';
import CumulativeChart from './cumulative-chart.vue';
import MonthlyComparisonChart from './monthly-comparison-chart.vue';

const props = defineProps<{
  chartWindow: Period;
  selected: Period;
  metric: MetricType;
  filters: TrendsFilters;
  colors: Record<string, string>;
  detail: boolean;
}>();

const emit = defineEmits<{
  'hide-category': [payload: { categoryId: string }];
  'show-category': [payload: { categoryId: string }];
  'select-period': [payload: Period];
}>();

const { t } = useI18n();
const { categories } = storeToRefs(useCategoriesStore());

const CHART_TYPES = ['monthly', 'cumulative'] as const;
type ChartType = (typeof CHART_TYPES)[number];

const chartType = useSessionStorage<ChartType>('trends-over-time-chart', 'monthly', {
  serializer: createEnumSerializer({ values: CHART_TYPES, fallback: 'monthly' }),
});
const granularity = useSessionStorage<BarGranularity>('trends-over-time-granularity', 'monthly', {
  serializer: createEnumSerializer({ values: BAR_GRANULARITIES, fallback: 'monthly' }),
});
const isMonthly = computed(() => chartType.value === 'monthly');

const chartTypeItems = computed<PillTabItem[]>(() => [
  { value: 'monthly', label: t('analytics.trends.overTime.perPeriod') },
  { value: 'cumulative', label: t('analytics.trends.overTime.cumulative') },
]);

const statsFilterParams = computed(() =>
  toStatsFilterParams({ filters: props.filters, categories: categories.value, detail: props.detail }),
);

// Whole months, widened to whole buckets, so the first and last bars aren't partial.
const barsParams = computed(() => ({
  ...snapToBuckets({
    from: startOfMonth(props.chartWindow.from),
    to: endOfMonth(props.chartWindow.to),
    granularity: granularity.value,
  }),
  granularity: 'monthly' as const,
  ...statsFilterParams.value,
}));

const {
  data: barsData,
  isLoading: isLoadingBars,
  isFetching: isFetchingBars,
  isError: isBarsError,
} = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.analyticsCashFlow, 'monthly-comparison', barsParams],
  queryFn: () => getCashFlow(barsParams.value),
  staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
  gcTime: QUERY_CACHE_STALE_TIME.ANALYTICS * 2,
  placeholderData: keepPreviousData,
  enabled: isMonthly,
});

const cumulativeParams = computed(() => ({
  from: props.chartWindow.from,
  to: props.chartWindow.to,
  metric: props.metric,
  ...statsFilterParams.value,
}));

const {
  data: cumulativeData,
  isLoading: isLoadingCumulative,
  isFetching: isFetchingCumulative,
  isError: isCumulativeError,
} = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.analyticsCumulative, cumulativeParams],
  queryFn: () => getCumulativeData(cumulativeParams.value),
  staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
  gcTime: QUERY_CACHE_STALE_TIME.ANALYTICS * 2,
  placeholderData: keepPreviousData,
  enabled: computed(() => !isMonthly.value),
});

const isLoading = computed(() => (isMonthly.value ? isLoadingBars.value : isLoadingCumulative.value));
const isFetching = computed(() => (isMonthly.value ? isFetchingBars.value : isFetchingCumulative.value));
const isError = computed(() => (isMonthly.value ? isBarsError.value : isCumulativeError.value));
</script>
