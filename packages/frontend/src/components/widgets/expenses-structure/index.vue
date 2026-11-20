<template>
  <WidgetWrapper :is-fetching="isWidgetDataFetching" class="max-h-auto" data-testid="widget-expenses-structure">
    <template #title>
      <div class="flex min-w-0 items-center gap-2">
        <DesktopOnlyTooltip v-if="drilledCategory" :content="trailPath">
          <Button
            variant="ghost"
            size="sm"
            class="h-7 min-w-0 gap-1 px-1.5 text-base font-semibold tracking-tight"
            :aria-label="$t('dashboard.widgets.expensesStructure.back')"
            data-testid="es-drill-back"
            @click="goUp"
          >
            <ChevronLeftIcon class="size-4 shrink-0" />
            <span class="truncate">{{ drilledCategory.name }}</span>
          </Button>
        </DesktopOnlyTooltip>
        <template v-else>{{ widgetTitle }}</template>

        <ExcludedCountBadge v-if="hasExcludedStats" :count="excludedCategoryIds.length" test-id="es-excluded-badge" />
      </div>
    </template>

    <template v-if="widgetConfigRef" #action>
      <DesktopOnlyTooltip
        v-if="!isDataEmpty && transactionsLink"
        :content="$t('dashboard.widgets.expensesStructure.seeTransactions')"
      >
        <span class="inline-flex">
          <router-link
            :class="buttonVariants({ variant: 'ghost', size: 'icon-sm', class: 'text-muted-foreground' })"
            :to="transactionsLink"
            :aria-label="$t('dashboard.widgets.expensesStructure.seeTransactions')"
            data-testid="es-see-transactions"
          >
            <ListIcon class="size-4" />
          </router-link>
        </span>
      </DesktopOnlyTooltip>

      <DesktopOnlyTooltip v-if="!isDataEmpty" :content="$t('dashboard.widgets.expensesStructure.openInAnalytics')">
        <span class="inline-flex">
          <router-link
            :class="buttonVariants({ variant: 'ghost', size: 'icon-sm', class: 'text-muted-foreground' })"
            :to="analyticsLink"
            :aria-label="$t('dashboard.widgets.expensesStructure.openInAnalytics')"
          >
            <ArrowUpRightIcon class="size-4" />
          </router-link>
        </span>
      </DesktopOnlyTooltip>

      <ExcludeCategoriesMenu
        :excluded-category-ids="excludedCategoryIds"
        test-id-prefix="es"
        @save="persistExcludedCategories"
      >
        <div class="px-2 py-2">
          <PillTabs
            size="sm"
            full-width
            :items="metricTabs"
            :model-value="metric"
            data-testid="es-metric-tabs"
            @update:model-value="onMetricChange"
          />
        </div>
        <IncludePlannedMenuItem test-id-prefix="es" />
      </ExcludeCategoriesMenu>
    </template>

    <!-- Stats row - two columns with space between -->
    <div v-if="!showError" class="mb-4 flex items-start justify-between gap-4">
      <!-- Left: Primary value -->
      <div>
        <div class="text-2xl font-bold tracking-tight">
          <template v-if="isWidgetDataFetching && !hasData">
            <div class="bg-muted h-8 w-32 animate-pulse rounded" />
          </template>
          <template v-else>
            {{ formatBaseCurrency(animatedTotal) }}
          </template>
        </div>
        <div class="text-muted-foreground mt-1 text-xs font-medium tracking-tight uppercase">
          {{ periodLabel }}
        </div>
      </div>

      <!-- Right: Comparison -->
      <div class="flex flex-col items-end gap-1">
        <template v-if="isWidgetDataFetching && !hasData">
          <div class="bg-muted h-6 w-16 animate-pulse rounded-full" />
        </template>
        <template v-else>
          <span
            v-if="periodDiff !== null"
            class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
            :class="{
              'bg-destructive-text/15 text-destructive-text': periodDiff !== 0 && !isGoodDiff,
              'bg-success-text/15 text-success-text': periodDiff !== 0 && isGoodDiff,
              'bg-muted text-muted-foreground': periodDiff === 0,
            }"
          >
            {{ periodDiff > 0 ? '+' : '' }}{{ periodDiff }}%
          </span>
        </template>
        <div v-if="periodDiff !== null" class="text-muted-foreground text-xs tracking-tight">
          {{ $t('dashboard.widgets.expensesStructure.vsPreviousPeriod') }}
        </div>
      </div>
    </div>

    <template v-if="isWidgetDataFetching && !hasData">
      <LoadingState />
    </template>
    <template v-else-if="showError">
      <ErrorState :message="$t('errors.api.unexpectedError')" @retry="refetch()" />
    </template>
    <template v-else-if="isDataEmpty">
      <EmptyState>
        <ChartPieIcon class="size-32" />
      </EmptyState>
    </template>
    <template v-else>
      <DonutChart
        :data="chartData"
        :total-amount="totalAmount"
        :class="cn('transition-opacity', isPlaceholderData && 'opacity-50')"
        clickable="drillable"
        @category-click="drilledCategoryId = $event.categoryId"
      />
    </template>
  </WidgetWrapper>
</template>

<script lang="ts" setup>
import { type MetricType, isGoodChange, metricTransactionType } from '@/common/utils/analytics-metric';
import { buildTrendsLocation } from '@/common/utils/trends-deep-link';
import ExcludeCategoriesMenu from '@/components/common/category-exclusions/exclude-categories-menu.vue';
import ExcludedCountBadge from '@/components/common/category-exclusions/excluded-count-badge.vue';
import { useCategoryExclusionsConfig } from '@/components/common/category-exclusions/use-category-exclusions-config';
import DonutChart from '@/components/common/charts/donut-chart.vue';
import { Button, buttonVariants } from '@/components/lib/ui/button';
import { type PillTabItem, PillTabs } from '@/components/lib/ui/pill-tabs';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import IncludePlannedMenuItem from '@/components/widgets/components/include-planned-menu-item.vue';
import { useIncludePlannedConfig, useWidgetConfigFlag } from '@/components/widgets/use-include-planned-config';
import { useFormatCurrency } from '@/composable';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes';
import { useCategoriesStore } from '@/stores';
import { ArrowUpRightIcon, ChartPieIcon, ChevronLeftIcon, ListIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import EmptyState from '../components/empty-state.vue';
import ErrorState from '../components/error-state.vue';
import LoadingState from '../components/loading-state.vue';
import WidgetWrapper from '../components/widget-wrapper.vue';

import { buildTrail, buildWidgetAnalyticsLink, getLevelTransactionCategoryIds, isDrillStale } from './drill-down';
import { useExpensesStructureData } from './use-expenses-structure-data';

defineOptions({
  name: 'expenses-structure-widget',
});

const props = defineProps<{
  selectedPeriod: { from: Date; to: Date };
}>();

const { t } = useI18n();
const { formatBaseCurrency } = useFormatCurrency();
const { categoriesMap } = storeToRefs(useCategoriesStore());

const { widgetConfigRef, excludedCategoryIds, persistExcludedCategories } = useCategoryExclusionsConfig();
const { includePlanned } = useIncludePlannedConfig();
const { isOn: showIncome, setFlag: setShowIncome } = useWidgetConfigFlag({
  key: 'showIncome',
  saveErrorKey: 'errors.api.unexpectedError',
  defaultValue: false,
});

const metric = computed<MetricType>(() => (showIncome.value ? 'income' : 'expenses'));
const metricTabs = computed<PillTabItem[]>(() => [
  { value: 'expenses', label: t('dashboard.widgets.expensesStructure.metric.expenses') },
  { value: 'income', label: t('dashboard.widgets.expensesStructure.metric.income') },
]);

const drilledCategoryId = ref<string | null>(null);
const trail = computed(() => buildTrail({ categoryId: drilledCategoryId.value, categoriesMap: categoriesMap.value }));
const drilledCategory = computed(() => trail.value.at(-1));
const widgetTitle = computed(() =>
  metric.value === 'income'
    ? t('dashboard.widgets.expensesStructure.incomeTitle')
    : t('dashboard.widgets.expensesStructure.title'),
);
const trailPath = computed(() => [widgetTitle.value, ...trail.value.map((category) => category.name)].join(' › '));

const onMetricChange = async (value: string) => {
  drilledCategoryId.value = null;
  await setShowIncome({ value: value === 'income' });
};

watch([trail, excludedCategoryIds], () => {
  if (drilledCategoryId.value && isDrillStale({ trail: trail.value, excludedCategoryIds: excludedCategoryIds.value })) {
    drilledCategoryId.value = null;
  }
});

const goUp = () => {
  drilledCategoryId.value = trail.value.at(-2)?.id ?? null;
};

const {
  hasExcludedStats,
  periodLabel,
  isWidgetDataFetching,
  animatedTotal,
  periodDiff,
  showError,
  refetch,
  chartData,
  isDataEmpty,
  hasData,
  isPlaceholderData,
  totalAmount,
} = useExpensesStructureData({
  selectedPeriod: () => props.selectedPeriod,
  excludedCategoryIds,
  includePlanned,
  metric,
  drilledCategoryId,
});

const isGoodDiff = computed(
  () => periodDiff.value !== null && isGoodChange({ metric: metric.value, change: periodDiff.value }),
);

const analyticsLink = computed(() =>
  buildTrendsLocation(
    buildWidgetAnalyticsLink({
      drilledCategoryId: drilledCategoryId.value,
      excludedCategoryIds: excludedCategoryIds.value,
      metric: metric.value,
      period: props.selectedPeriod,
    }),
  ),
);

const transactionsLink = computed(() => {
  const categoryIds = getLevelTransactionCategoryIds({
    drilledCategoryId: drilledCategoryId.value,
    categoriesMap: categoriesMap.value,
    excludedCategoryIds: excludedCategoryIds.value,
  });
  if (categoryIds === null) return null;

  return {
    name: ROUTES_NAMES.transactions,
    query: {
      categoryIds,
      start: props.selectedPeriod.from.toISOString(),
      end: props.selectedPeriod.to.toISOString(),
      transactionType: metricTransactionType({ metric: metric.value }),
    },
  };
});
</script>
