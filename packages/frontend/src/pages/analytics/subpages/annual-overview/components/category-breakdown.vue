<template>
  <div class="border-border bg-card rounded-lg border p-4">
    <h3 class="mb-4 text-lg font-semibold">{{ t('analytics.trends.categoryBreakdown.title') }}</h3>

    <!-- Loading skeleton -->
    <CategoryListSkeleton v-if="isLoading" />

    <!-- Empty state -->
    <div v-else-if="sortedCategories.length === 0" class="flex h-40 items-center justify-center">
      <div class="text-muted-foreground text-sm">{{ t('analytics.trends.categoryBreakdown.noData') }}</div>
    </div>

    <!-- Category list -->
    <div v-else class="space-y-3">
      <div v-for="category in displayedCategories" :key="category.id" class="group flex items-center gap-3">
        <!-- Color dot -->
        <span class="size-3 shrink-0 rounded-full" :style="{ backgroundColor: category.color }"></span>

        <!-- Name and amount -->
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-2">
            <span class="truncate text-sm font-medium">{{ category.name }}</span>
            <div class="flex shrink-0 items-center gap-2">
              <span class="text-sm font-medium">{{ formatBaseCurrency(category.amount) }}</span>
              <span
                v-if="category.change !== undefined"
                :class="[
                  'flex items-center gap-0.5 text-xs font-medium',
                  category.change > 0
                    ? isIncome
                      ? 'text-green-500'
                      : 'text-red-500'
                    : category.change < 0
                      ? isIncome
                        ? 'text-red-500'
                        : 'text-green-500'
                      : 'text-muted-foreground',
                ]"
                :title="t('analytics.trends.vsPreviousPeriod')"
              >
                <component :is="getChangeIcon(category.change)" class="size-3" />
                {{ Math.abs(category.change) }}%
              </span>
            </div>
          </div>

          <!-- Progress bar -->
          <div class="bg-muted mt-1 h-1.5 w-full overflow-hidden rounded-full">
            <div
              class="h-full rounded-full transition-all duration-300"
              :style="{
                width: `${category.percentage}%`,
                backgroundColor: category.color,
              }"
            ></div>
          </div>
        </div>
      </div>

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
</template>

<script setup lang="ts">
import { useFormatCurrency } from '@/composable';
import type { RecordId, GetSpendingsByCategoriesReturnType } from '@bt/shared/types';
import { ArrowDownIcon, ArrowUpIcon, MinusIcon } from '@lucide/vue';
import { type Component, computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import CategoryListSkeleton from '../../cash-flow/components/category-list-skeleton.vue';

interface CategoryWithChange {
  id: string;
  name: string;
  color: string;
  amount: number;
  percentage: number;
  change?: number;
}

const props = defineProps<{
  currentPeriodData: GetSpendingsByCategoriesReturnType;
  previousPeriodData: GetSpendingsByCategoriesReturnType;
  isLoading: boolean;
  isIncome?: boolean;
}>();

const { t } = useI18n();
const { formatBaseCurrency } = useFormatCurrency();

const defaultDisplayCount = 10;
const showAll = ref(false);

const sortedCategories = computed<CategoryWithChange[]>(() => {
  const entries = Object.entries(props.currentPeriodData);
  if (entries.length === 0) return [];

  const totalAmount = entries.reduce((sum, [, cat]) => sum + cat.amount, 0);

  return entries
    .map(([id, cat]) => {
      const prevCat = props.previousPeriodData[id as RecordId];
      let change: number | undefined;

      if (prevCat && prevCat.amount > 0) {
        change = Math.round(((cat.amount - prevCat.amount) / prevCat.amount) * 100);
      } else if (cat.amount > 0 && (!prevCat || prevCat.amount === 0)) {
        change = 100; // New category or was 0 last year
      }

      return {
        id,
        name: cat.name,
        color: cat.color,
        amount: cat.amount,
        percentage: totalAmount > 0 ? (cat.amount / totalAmount) * 100 : 0,
        change,
      };
    })
    .filter((cat) => cat.amount > 0)
    .sort((a, b) => b.amount - a.amount);
});

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
