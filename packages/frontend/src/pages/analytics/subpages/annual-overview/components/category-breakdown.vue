<template>
  <div class="border-border bg-card @container/breakdown rounded-lg border p-4">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h3 class="text-lg font-semibold">{{ t('analytics.trends.categoryBreakdown.title') }}</h3>
      <div class="flex w-full items-center gap-2 @md/breakdown:w-auto">
        <Loader2Icon v-if="isFetching" class="text-muted-foreground size-4 shrink-0 animate-spin" />
        <PillTabs
          full-width
          size="sm"
          :items="modeItems"
          :model-value="detail ? 'detail' : 'level'"
          @update:model-value="(value) => emit('update:detail', value === 'detail')"
        />
      </div>
    </div>

    <div
      v-if="isLoading"
      class="grid animate-pulse items-start gap-4 @2xl/breakdown:grid-cols-[minmax(0,300px)_minmax(350px,1fr)] @2xl/breakdown:gap-6"
    >
      <div class="border-muted mx-auto aspect-square w-full max-w-75 rounded-full border-36" />
      <div class="space-y-1">
        <div v-for="i in 6" :key="i" class="flex items-center gap-3 py-2">
          <div class="bg-muted size-8 shrink-0 rounded-full" />
          <div class="flex-1 space-y-2">
            <div class="flex justify-between gap-2">
              <div class="bg-muted h-4 w-32 rounded" />
              <div class="bg-muted h-4 w-20 rounded" />
            </div>
            <div class="flex items-center gap-3">
              <div class="bg-muted h-1.5 flex-1 rounded-full" />
              <div class="bg-muted h-3 w-16 rounded" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="isError" class="flex h-40 items-center justify-center">
      <div class="text-destructive-text">{{ t('analytics.trends.loadError') }}</div>
    </div>

    <!-- Empty state -->
    <div v-else-if="sortedCategories.length === 0" class="flex h-40 items-center justify-center">
      <div class="text-muted-foreground text-sm">{{ t('analytics.trends.categoryBreakdown.noData') }}</div>
    </div>

    <div
      v-else
      class="grid items-start gap-4 @2xl/breakdown:grid-cols-[minmax(0,300px)_minmax(350px,1fr)] @2xl/breakdown:gap-6"
    >
      <DonutChart
        class="mx-auto aspect-square h-auto max-w-75 @2xl/breakdown:sticky @2xl/breakdown:top-[calc(var(--header-height)+var(--trends-controls-height,0)+1rem)]"
        :data="donutData"
        :total-amount="totalAmount"
        @category-click="
          ({ categoryId }) =>
            categoryId !== scopeCategoryId && categoryId !== OTHERS_SLICE_ID && emit('select', { categoryId })
        "
      />

      <div class="min-w-0 space-y-1">
        <component
          :is="category.isScope ? 'div' : Button"
          v-for="category in displayedCategories"
          :key="category.id"
          v-bind="category.isScope ? {} : { variant: 'ghost', type: 'button' }"
          class="-mx-2 flex h-auto w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-2 text-left font-normal"
          @click="!category.isScope && emit('select', { categoryId: category.id })"
        >
          <CategoryCircle
            v-if="categoriesMap[category.id] && !(category.isScope && scopeHasChildren)"
            :category="{ ...categoriesMap[category.id]!, color: category.color }"
          />
          <span v-else class="size-6 shrink-0 rounded-full" :style="swatchStyle({ category })"></span>

          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-2">
              <span class="min-w-0 truncate text-sm font-medium">
                {{ category.name }}
                <span v-if="category.path" class="text-muted-foreground font-normal">· {{ category.path }}</span>
              </span>
              <span class="shrink-0 text-sm font-medium tabular-nums">{{ formatBaseCurrency(category.amount) }}</span>
            </div>

            <div class="mt-1.5 flex items-center gap-3">
              <div class="bg-foreground/10 h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
                <div
                  class="h-full rounded-full transition-all duration-300"
                  :style="{ ...swatchStyle({ category }), width: `${category.percentage}%` }"
                ></div>
              </div>
              <span class="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
                {{ Math.round(category.percentage) }}%
                <span
                  v-if="category.change !== undefined"
                  :class="['flex items-center gap-0.5 font-medium', changeClass(category.change)]"
                  :title="t('analytics.trends.vsPreviousPeriod')"
                >
                  <component :is="getChangeIcon(category.change)" class="size-3" />
                  {{ Math.abs(category.change) }}%
                </span>
              </span>
            </div>
          </div>

          <ChevronRightIcon v-if="!category.isScope" class="text-muted-foreground size-4 shrink-0" />
          <span v-else class="size-4 shrink-0"></span>
        </component>

        <!-- View all button -->
        <button
          v-if="sortedCategories.length > defaultDisplayCount && !showAll"
          class="text-primary-text mt-2 w-full py-2 text-center text-sm hover:underline"
          @click="showAll = true"
        >
          {{ t('analytics.trends.categoryBreakdown.viewAll') }} ({{
            t('analytics.trends.categoryBreakdown.moreCount', { count: sortedCategories.length - defaultDisplayCount })
          }})
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import CategoryCircle from '@/components/common/category-circle.vue';
import { Button } from '@/components/lib/ui/button';
import { type PillTabItem, PillTabs } from '@/components/lib/ui/pill-tabs';
import { useFormatCurrency } from '@/composable';
import { useCategoriesStore } from '@/stores';
import type { RecordId, GetSpendingsByCategoriesReturnType } from '@bt/shared/types';
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, Loader2Icon, MinusIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { type Component, computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import DonutChart from '@/components/widgets/expenses-structure/donut-chart.vue';

import { getAncestors, hasChildren, isRemainderRow } from '../category-tree';
import { OTHERS_SLICE_ID, foldSmallSlices } from '../fold-small-slices';
import { type MetricType, isGoodChange, percentChange } from '../metric';

interface CategoryWithChange {
  id: string;
  name: string;
  color: string;
  amount: number;
  percentage: number;
  change?: number;
  isScope: boolean;
  path?: string;
}

const props = defineProps<{
  currentPeriodData: GetSpendingsByCategoriesReturnType;
  previousPeriodData: GetSpendingsByCategoriesReturnType;
  isLoading: boolean;
  isFetching?: boolean;
  isError?: boolean;
  metric: MetricType;
  /** The category the page is drilled into; its own row holds what is booked on it directly. */
  scopeCategoryId?: string;
  colors: Record<string, string>;
  /** Every category on its own row at any depth, instead of one level with roll-ups. */
  detail: boolean;
}>();

const emit = defineEmits<{
  select: [payload: { categoryId: string }];
  'update:detail': [value: boolean];
}>();

const { categories, categoriesMap } = storeToRefs(useCategoriesStore());

const pathBelowScope = ({ id }: { id: string }) =>
  getAncestors({ id, categoriesMap: categoriesMap.value, stopId: props.scopeCategoryId })
    .map((category) => category.name)
    .join(' › ');

const modeItems = computed<PillTabItem[]>(() => [
  { value: 'level', label: t('analytics.trends.categoryBreakdown.byLevel') },
  { value: 'detail', label: t('analytics.trends.categoryBreakdown.detail') },
]);

const scopeHasChildren = computed(() => hasChildren({ id: props.scopeCategoryId, categories: categories.value }));

const { t } = useI18n();
const { formatBaseCurrency } = useFormatCurrency();

const defaultDisplayCount = 10;
const showAll = ref(false);
watch(
  () => [props.scopeCategoryId, props.detail, props.metric],
  () => {
    showAll.value = false;
  },
);

const sortedCategories = computed<CategoryWithChange[]>(() => {
  const entries = Object.entries(props.currentPeriodData);
  if (entries.length === 0) return [];

  const totalAmount = entries.reduce((sum, [, cat]) => sum + cat.amount, 0);

  return entries
    .map(([id, cat]) => {
      const previous = props.previousPeriodData[id as RecordId]?.amount ?? 0;
      const isScope = id === props.scopeCategoryId;
      const isRemainder = isRemainderRow({
        id,
        scopeId: props.scopeCategoryId,
        detail: props.detail,
        categories: categories.value,
      });

      return {
        id,
        name: isRemainder ? t('analytics.trends.categoryBreakdown.noSubcategory', { name: cat.name }) : cat.name,
        path: props.detail ? pathBelowScope({ id }) : undefined,
        color: props.colors[id] ?? cat.color,
        isScope,
        amount: cat.amount,
        percentage: totalAmount > 0 ? (cat.amount / totalAmount) * 100 : 0,
        change: percentChange({ current: cat.amount, previous }),
      };
    })
    .filter((cat) => cat.amount > 0)
    .sort((a, b) => b.amount - a.amount);
});

const swatchStyle = ({ category }: { category: CategoryWithChange }) =>
  category.isScope && scopeHasChildren.value
    ? { background: `repeating-linear-gradient(135deg, ${category.color} 0 3px, transparent 3px 5px)` }
    : { backgroundColor: category.color };

const changeClass = (change: number) => {
  if (change === 0) return 'text-muted-foreground';
  return isGoodChange({ metric: props.metric, change }) ? 'text-success-text' : 'text-destructive-text';
};

const totalAmount = computed(() => sortedCategories.value.reduce((sum, category) => sum + category.amount, 0));

const donutData = computed(() =>
  foldSmallSlices({
    slices: sortedCategories.value.map(({ id, name, color, amount }) => ({ categoryId: id, name, color, amount })),
    minShare: 10 / 360,
    othersName: t('analytics.trends.categoryBreakdown.others'),
  }),
);

const displayedCategories = computed(() => {
  if (showAll.value) {
    return sortedCategories.value;
  }
  return sortedCategories.value.slice(0, defaultDisplayCount);
});

const getChangeIcon = (change: number | undefined): Component => {
  if (change === undefined || change === 0) return MinusIcon;
  return change > 0 ? ArrowUpIcon : ArrowDownIcon;
};
</script>
