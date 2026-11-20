<template>
  <WidgetWrapper :is-fetching="isFetching" data-testid="widget-tag-analysis">
    <template #title>{{ $t('dashboard.widgets.tagAnalysis.title') }}</template>

    <template v-if="widgetConfigRef" #action>
      <TagAnalysisSettingsPopover />
    </template>

    <LoadingState v-if="!isTagsFetched" />
    <div
      v-else-if="selectedTags.length === 0"
      class="flex min-h-55 flex-1 flex-col items-center justify-center text-center"
      data-testid="tag-analysis-no-tags"
    >
      <div class="bg-muted mb-4 flex size-12 items-center justify-center rounded-full">
        <TagsIcon class="text-muted-foreground size-6" />
      </div>
      <h3 class="mb-2 text-lg font-semibold">{{ $t('dashboard.widgets.tagAnalysis.noTagsTitle') }}</h3>
      <p class="text-muted-foreground max-w-xs text-sm">
        {{ $t('dashboard.widgets.tagAnalysis.noTagsDescription') }}
      </p>
    </div>
    <ErrorState v-else-if="showError" :message="$t('errors.api.unexpectedError')" @retry="refetch" />
    <LoadingState v-else-if="!hasData" />
    <EmptyState v-else-if="summary.total === 0">
      <ChartPieIcon class="size-32" />
    </EmptyState>
    <div v-else class="@container/tag-analysis min-h-0 flex-1">
      <div
        class="grid h-full grid-cols-1 items-center gap-4 md:grid-rows-[minmax(0,1fr)] md:@max-md/tag-analysis:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:@max-md/tag-analysis:gap-2 @md/tag-analysis:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @md/tag-analysis:gap-6"
      >
        <DonutChart
          :data="chartData"
          :total-amount="summary.total"
          @category-click="openTransactions"
          class="h-52 md:@max-md/tag-analysis:h-48 @md/tag-analysis:h-55"
        >
          <template v-if="summary.incomePercent !== null" #center>
            <div class="text-xl font-semibold">{{ formatPercent(summary.incomePercent) }}</div>
            <div class="text-muted-foreground text-xs">{{ $t('dashboard.widgets.tagAnalysis.ofIncome') }}</div>
          </template>
        </DonutChart>

        <div class="flex h-full min-h-0 flex-col">
          <ScrollArea class="my-auto min-h-0" viewport-class="md:overscroll-contain-if-scrollable">
            <ul class="flex flex-col gap-2.5 py-1 pr-3 md:@max-md/tag-analysis:gap-3 @md/tag-analysis:gap-4">
              <li v-for="row in rows" :key="row.tagId" data-testid="tag-analysis-row">
                <div class="flex items-center gap-2 text-sm">
                  <span class="size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: row.tag.color }" />
                  <span class="min-w-0 flex-1 truncate md:@max-md/tag-analysis:font-medium">
                    {{ row.tag.name }}
                  </span>
                  <span class="font-medium tabular-nums md:@max-md/tag-analysis:hidden">
                    {{ formatCompactLargeBaseCurrency({ amount: row.amount }) }}
                  </span>
                  <span
                    v-if="row.percent !== null"
                    :class="
                      cn(
                        'w-11 text-right tabular-nums md:@max-md/tag-analysis:w-auto md:@max-md/tag-analysis:font-semibold',
                        row.isOverTarget
                          ? 'text-warning-text font-medium'
                          : 'text-muted-foreground md:@max-md/tag-analysis:text-foreground',
                      )
                    "
                  >
                    {{ formatPercent(row.percent) }}
                  </span>
                </div>

                <div class="text-muted-foreground hidden pl-4.5 text-xs tabular-nums md:@max-md/tag-analysis:block">
                  {{ formatCompactLargeBaseCurrency({ amount: row.amount }) }}
                </div>

                <div class="bg-muted relative mt-2 hidden h-1.5 rounded-full @md/tag-analysis:block">
                  <div
                    class="h-full rounded-full"
                    :style="{ width: `${Math.min(row.percent ?? 0, 100)}%`, backgroundColor: row.tag.color }"
                  />
                  <DesktopOnlyTooltip
                    v-if="row.target !== null"
                    :content="$t('dashboard.widgets.tagAnalysis.targetTooltip', { value: row.target })"
                  >
                    <span
                      class="absolute -top-1 flex h-3.5 w-3 -translate-x-1/2 justify-center"
                      :style="{ left: `${row.target}%` }"
                    >
                      <span class="bg-foreground h-full w-0.5 rounded-full" />
                    </span>
                  </DesktopOnlyTooltip>
                </div>
              </li>
            </ul>
          </ScrollArea>
        </div>
      </div>
    </div>
  </WidgetWrapper>
</template>

<script lang="ts" setup>
import { getPivotReport } from '@/api/stats';
import type { DashboardWidgetConfig } from '@/api/user-settings';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import DonutChart from '@/components/common/charts/donut-chart.vue';
import type { DonutChartItem } from '@/components/common/charts/donut-chart-item';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { ROUTES_NAMES } from '@/routes';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable';
import { cn } from '@/lib/utils';
import { useTagsStore } from '@/stores';
import { FILTER_OPERATION, TRANSACTION_TYPES, type TagModel } from '@bt/shared/types';
import { ChartPieIcon, TagsIcon } from '@lucide/vue';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { storeToRefs } from 'pinia';
import { type Ref, computed, inject } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';

import EmptyState from '../components/empty-state.vue';
import ErrorState from '../components/error-state.vue';
import LoadingState from '../components/loading-state.vue';
import WidgetWrapper from '../components/widget-wrapper.vue';
import TagAnalysisSettingsPopover from './tag-analysis-settings-popover.vue';
import { buildTagShares, readTagAnalysisConfig } from './tag-analysis-config';

defineOptions({
  name: 'tag-analysis-widget',
});

const props = defineProps<{
  selectedPeriod: { from: Date; to: Date };
}>();

const REMAINING_SLICE_ID = 'remaining';

const { t } = useI18n();
const router = useRouter();
const { formatCompactLargeBaseCurrency } = useFormatCurrency();

const tagsStore = useTagsStore();
const { tagsMap, isFetched: isTagsFetched } = storeToRefs(tagsStore);
if (!tagsStore.isFetched && !tagsStore.isLoading) tagsStore.loadTags();

const widgetConfigRef = inject<Ref<DashboardWidgetConfig> | null>('dashboard-widget-config', null);
const config = computed(() => readTagAnalysisConfig({ widgetConfig: widgetConfigRef?.value }));

const selectedTags = computed(() =>
  config.value.tagIds.map((id) => tagsMap.value[id]).filter((tag): tag is TagModel => !!tag),
);

const periodKey = computed(() => `${props.selectedPeriod.from.getTime()}-${props.selectedPeriod.to.getTime()}`);
const includeTransfers = computed(() => config.value.includeTransfers);
const hasTags = computed(() => selectedTags.value.length > 0);
const isIncomeBase = computed(() => config.value.percentBase === 'income');

const tagsQuery = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.widgetTagAnalysis, periodKey, includeTransfers],
  queryFn: () =>
    getPivotReport({
      from: props.selectedPeriod.from,
      to: props.selectedPeriod.to,
      granularity: 'yearly',
      rowDimension: 'tag',
      measure: 'expense',
      includeTransfers: includeTransfers.value,
    }),
  staleTime: Infinity,
  placeholderData: keepPreviousData,
  enabled: hasTags,
});

const incomeQuery = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.widgetTagAnalysisIncome, periodKey],
  queryFn: () =>
    getPivotReport({
      from: props.selectedPeriod.from,
      to: props.selectedPeriod.to,
      granularity: 'yearly',
      rowDimension: 'category',
      measure: 'income',
    }),
  staleTime: Infinity,
  placeholderData: keepPreviousData,
  enabled: computed(() => hasTags.value && isIncomeBase.value),
});

const isFetching = computed(() => tagsQuery.isFetching.value || incomeQuery.isFetching.value);
const hasData = computed(
  () => tagsQuery.data.value !== undefined && (!isIncomeBase.value || incomeQuery.data.value !== undefined),
);
const showError = computed(
  () => (tagsQuery.isError.value || (isIncomeBase.value && incomeQuery.isError.value)) && !hasData.value,
);
const refetch = () => Promise.all([tagsQuery.refetch(), isIncomeBase.value && incomeQuery.refetch()]);

const summary = computed(() =>
  buildTagShares({
    tagIds: selectedTags.value.map((tag) => tag.id),
    totalsByTagId: Object.fromEntries((tagsQuery.data.value?.rows ?? []).map((row) => [row.id, row.total])),
    targets: config.value.targets,
    percentBase: config.value.percentBase,
    incomeTotal: incomeQuery.data.value?.grandTotal ?? null,
  }),
);

const rows = computed(() => summary.value.rows.map((row) => ({ ...row, tag: tagsMap.value[row.tagId]! })));

const formatPercent = (value: number) => `${Math.round(value)}%`;

const chartData = computed<DonutChartItem[]>(() => {
  const slices: DonutChartItem[] = rows.value
    .filter((row) => row.amount > 0)
    .map((row) => ({
      categoryId: row.tagId,
      name: row.tag.name,
      color: row.tag.color,
      amount: row.amount,
      label: row.percent !== null ? formatPercent(row.percent) : undefined,
    }));

  if (summary.value.remaining > 0) {
    slices.push({
      categoryId: REMAINING_SLICE_ID,
      name: t('dashboard.widgets.tagAnalysis.remaining'),
      color: 'var(--muted)',
      amount: summary.value.remaining,
      isDrillable: false,
    });
  }

  return slices;
});

const openTransactions = (item: DonutChartItem) =>
  router.push({
    name: ROUTES_NAMES.transactions,
    query: {
      tagIds: item.categoryId,
      start: props.selectedPeriod.from.toISOString(),
      end: props.selectedPeriod.to.toISOString(),
      transactionType: TRANSACTION_TYPES.expense,
      transferFilter: config.value.includeTransfers ? FILTER_OPERATION.all : FILTER_OPERATION.exclude,
    },
  });
</script>
