<template>
  <div class="@container/trends" :style="{ '--trends-controls-height': `${controlsHeight}px` }">
    <div class="grid gap-6 @5xl/trends:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] @5xl/trends:items-start">
      <div class="min-w-0 space-y-6">
        <div
          ref="controlsRef"
          class="border-border bg-card @container/controls sticky top-(--header-height) z-(--z-navbar) rounded-lg border"
        >
          <div class="flex items-center gap-2 px-2 py-1.5">
            <MetricToggle v-model="selectedMetric" class="shrink-0" />
            <PeriodSelector v-model="selectedPeriod" fluid class="flex-1 justify-start @lg/controls:flex-none" />
            <FiltersButton
              :label="t('analytics.trends.filters.button')"
              :active-count="countActiveFilters({ filters })"
              label-class="hidden @lg/controls:inline"
              class="ml-auto shrink-0"
            >
              <TrendsFiltersPanel :filters="filters" @update:filters="filters = $event" />
            </FiltersButton>
          </div>

          <CategoryScopeBar
            class="border-border border-t px-2 py-1.5"
            :filters="filters"
            :from="selectedPeriod.from"
            :to="selectedPeriod.to"
            :metric="selectedMetric"
            @update:filters="filters = $event"
          />

          <div
            v-if="!isCategoriesError"
            :class="
              cn(
                'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
                isHeroHidden ? 'grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0',
              )
            "
            :aria-hidden="!isHeroHidden"
          >
            <div class="overflow-hidden">
              <div class="border-border flex items-baseline gap-2 border-t px-3 py-1.5 text-sm">
                <span class="text-muted-foreground">{{ metricLabel }}</span>
                <span class="font-semibold tabular-nums">{{ formatBaseCurrency(currentTotal) }}</span>
                <span
                  v-if="totalChange !== undefined"
                  :class="cn('flex items-center gap-0.5 self-center text-xs font-medium', changeClass)"
                >
                  <component :is="changeIcon" class="size-3.5 shrink-0" />
                  {{ Math.abs(totalChange) }}%
                </span>
              </div>
            </div>
          </div>
        </div>

        <div ref="heroRef" class="px-1">
          <div class="text-muted-foreground text-sm font-medium">{{ metricLabel }}</div>
          <div v-if="isLoadingCategories" class="animate-pulse">
            <div class="bg-muted mt-1 h-10 w-56 rounded" />
            <div class="bg-muted mt-1.5 h-4 w-72 rounded" />
          </div>
          <div v-else-if="isCategoriesError" class="text-destructive-text mt-1">
            {{ t('analytics.trends.loadError') }}
          </div>
          <template v-else>
            <div class="text-4xl font-bold tracking-tight tabular-nums">{{ formatBaseCurrency(currentTotal) }}</div>
            <div
              v-if="totalChange !== undefined"
              :class="cn('mt-0.5 flex items-center gap-1 text-sm font-medium', changeClass)"
            >
              <component :is="changeIcon" class="size-4 shrink-0" />
              {{
                totalChange === 0
                  ? t('analytics.trends.hero.same')
                  : t('analytics.trends.hero.vsPrevious', { percent: Math.abs(totalChange) })
              }}
              <span class="text-muted-foreground font-normal tabular-nums"
                >({{ formatBaseCurrency(previousTotal) }})</span
              >
            </div>
          </template>
        </div>

        <CategoryBreakdown
          :current-period-data="currentPeriodCategories || {}"
          :previous-period-data="previousPeriodCategories || {}"
          :is-loading="isLoadingCategories"
          :is-fetching="isFetchingCategories"
          :is-error="isCategoriesError"
          :metric="selectedMetric"
          :scope-category-id="getScopeCategoryId({ filters })"
          v-model:detail="isDetail"
          :colors="seriesColors"
          @select="drillInto"
        />

        <OverTimeCard
          :chart-window="chartWindow"
          :selected="selectedPeriod"
          :metric="selectedMetric"
          :filters="filters"
          :colors="seriesColors"
          :detail="isDetail"
          @hide-category="filters = hideCategory({ filters, categoryId: $event.categoryId })"
          @show-category="filters = showCategory({ filters, categoryId: $event.categoryId })"
          @select-period="selectedPeriod = $event"
        />
      </div>

      <TransactionsCard
        :filters="filters"
        :period="selectedPeriod"
        :metric="selectedMetric"
        class="@5xl/trends:sticky @5xl/trends:top-[calc(var(--header-height)+1rem)]"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { getSpendingsByCategories } from '@/api';
import { QUERY_CACHE_STALE_TIME, VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useFormatCurrency } from '@/composable';
import { assignSiblingColors } from '@/composable/charts/assign-sibling-colors';
import { type Period, getPrevPeriod } from '@/composable/use-period-navigation';
import { cn } from '@/lib/utils';
import { useCategoriesStore } from '@/stores';
import { ArrowDownIcon, ArrowUpIcon, MinusIcon } from '@lucide/vue';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { useElementBounding, useSessionStorage } from '@vueuse/core';
import { endOfMonth, startOfMonth } from 'date-fns';
import { storeToRefs } from 'pinia';
import { computed, onMounted, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import FiltersButton from '../../components/filters-button.vue';
import { createEnumSerializer, createPeriodSerializer } from '../../utils';
import PeriodSelector from '../cash-flow/components/period-selector.vue';
import { getChartWindow } from './chart-window';
import CategoryBreakdown from './components/category-breakdown.vue';
import CategoryScopeBar from './components/category-scope-bar.vue';
import MetricToggle from './components/metric-toggle.vue';
import OverTimeCard from './components/over-time-card.vue';
import TransactionsCard from './components/transactions-card.vue';
import TrendsFiltersPanel from './components/trends-filters-panel.vue';
import {
  METRICS,
  METRIC_LABEL_KEYS,
  type MetricType,
  isGoodChange,
  metricTransactionType,
  percentChange,
} from './metric';
import {
  type TrendsFilters,
  countActiveFilters,
  emptyTrendsFilters,
  getScopeCategoryId,
  hideCategory,
  parseTrendsFilters,
  scopeTo,
  showCategory,
  toStatsFilterParams,
} from './trends-filters';

const { t } = useI18n();
const { formatBaseCurrency } = useFormatCurrency();
const route = useRoute();
const router = useRouter();
const { categories, categoriesMap } = storeToRefs(useCategoriesStore());

const getDefaultPeriod = (): Period => ({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) });

const selectedPeriod = useSessionStorage<Period>('trends-comparison-period', getDefaultPeriod(), {
  serializer: createPeriodSerializer({ getDefaultPeriod }),
});
const selectedMetric = useSessionStorage<MetricType>('trends-comparison-metric', 'expenses', {
  serializer: createEnumSerializer({ values: METRICS, fallback: 'expenses' }),
});
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
    filters.value = scopeTo({ filters: filters.value, categoryIds });
  }

  // Replace rather than push so back-navigation still leaves the page.
  const { categoryIds: _consumed, ...restQuery } = route.query;
  router.replace({ query: restQuery });
});

const isDetail = useSessionStorage('trends-breakdown-detail', false);

const statsFilterParams = computed(() =>
  toStatsFilterParams({ filters: filters.value, categories: categories.value, detail: isDetail.value }),
);

const drillInto = ({ categoryId }: { categoryId: string }) => {
  filters.value = scopeTo({ filters: filters.value, categoryIds: [categoryId] });
};

const metricLabel = computed(() => t(METRIC_LABEL_KEYS[selectedMetric.value]));

const chartWindow = computed(() => getChartWindow({ period: selectedPeriod.value }));
const previousPeriod = computed(() => getPrevPeriod({ period: selectedPeriod.value }));

const categoryType = computed(() => metricTransactionType({ metric: selectedMetric.value }));

const useSpendings = ({ key, period }: { key: string; period: () => Period }) =>
  useQuery({
    queryKey: computed(() => [
      ...VUE_QUERY_CACHE_KEYS.analyticsSpendingsByCategories,
      key,
      { ...period(), type: categoryType.value, ...statsFilterParams.value },
    ]),
    queryFn: () => getSpendingsByCategories({ ...period(), type: categoryType.value, ...statsFilterParams.value }),
    staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
    gcTime: QUERY_CACHE_STALE_TIME.ANALYTICS * 2,
    placeholderData: keepPreviousData,
  });

const {
  data: currentPeriodCategories,
  isLoading: isLoadingCurrent,
  isFetching: isFetchingCurrent,
  isError: isErrorCurrent,
} = useSpendings({
  key: 'current',
  period: () => selectedPeriod.value,
});
const {
  data: previousPeriodCategories,
  isLoading: isLoadingPrevious,
  isFetching: isFetchingPrevious,
  isError: isErrorPrevious,
} = useSpendings({
  key: 'previous',
  period: () => previousPeriod.value,
});
const { data: windowCategories } = useSpendings({ key: 'window', period: () => chartWindow.value });

const isLoadingCategories = computed(() => isLoadingCurrent.value || isLoadingPrevious.value);
const isFetchingCategories = computed(() => isFetchingCurrent.value || isFetchingPrevious.value);
const isCategoriesError = computed(() => isErrorCurrent.value || isErrorPrevious.value);

const sumAmounts = ({ data }: { data: typeof currentPeriodCategories.value }) =>
  Object.values(data ?? {}).reduce((sum, category) => sum + category.amount, 0);

const currentTotal = computed(() => sumAmounts({ data: currentPeriodCategories.value }));
const previousTotal = computed(() => sumAmounts({ data: previousPeriodCategories.value }));

const totalChange = computed(() => percentChange({ current: currentTotal.value, previous: previousTotal.value }));

const changeIcon = computed(() => {
  const change = totalChange.value ?? 0;
  return change === 0 ? MinusIcon : change > 0 ? ArrowUpIcon : ArrowDownIcon;
});

const changeClass = computed(() => {
  const change = totalChange.value ?? 0;
  if (change === 0) return 'text-muted-foreground';
  return isGoodChange({ metric: selectedMetric.value, change }) ? 'text-success-text' : 'text-destructive-text';
});

// Ranked by the chart window's totals so colors hold still while stepping through its months.
const seriesColors = computed(() => {
  const scopeId = getScopeCategoryId({ filters: filters.value });
  return assignSiblingColors({
    items: Object.entries({ ...currentPeriodCategories.value, ...windowCategories.value })
      .sort(([, a], [, b]) => b.amount - a.amount)
      .map(([id, { color }]) => ({ id, color })),
    parentColor: scopeId ? categoriesMap.value[scopeId]?.color : undefined,
  });
});

// The headline total slides into the sticky controls once it has scrolled under them.
const { bottom: controlsBottom, height: controlsHeight } = useElementBounding(
  useTemplateRef<HTMLElement>('controlsRef'),
);
const { bottom: heroBottom } = useElementBounding(useTemplateRef<HTMLElement>('heroRef'));
const isHeroHidden = computed(() => heroBottom.value < controlsBottom.value);
</script>
