<script setup lang="ts">
import CategoryCircle from '@/components/common/category-circle.vue';
import { Card } from '@/components/lib/ui/card';
import { useFormatCurrency } from '@/composable';
import { BudgetModel } from '@bt/shared/types';
import { format } from 'date-fns';
import { ArchiveIcon, ArrowRightIcon, CalendarIcon, TagsIcon } from '@lucide/vue';

import BudgetStatsSkeleton from '../budget-stats-skeleton.vue';
import BudgetCardDropdown from './shared/budget-card-dropdown.vue';
import BudgetCardStats from './shared/budget-card-stats.vue';
import BudgetCardUtilization from './shared/budget-card-utilization.vue';

defineProps<{
  budget: BudgetModel;
  isArchived?: boolean;
  stats: {
    actualIncome: number;
    actualExpense: number;
    balance: number;
    utilizationRate: number;
  } | null;
  isStatsLoading: boolean;
  timeStatus: { status: 'ended' | 'upcoming' | 'active'; text: string } | null;
}>();

const emit = defineEmits<{
  edit: [];
  delete: [];
  archive: [];
}>();

const { formatBaseCurrency } = useFormatCurrency();

const formatDate = (date: Date | string | undefined | null) => {
  if (!date) return null;
  return format(new Date(date), 'MMM d, yyyy');
};
</script>

<template>
  <Card
    :class="[
      'group relative flex cursor-pointer flex-col overflow-hidden transition-all duration-200 hover:border-white/20 hover:bg-white/2',
      isArchived && 'opacity-50',
    ]"
  >
    <!-- Status Banner -->
    <div
      :class="[
        'flex items-center justify-center py-1.5 text-xs font-medium',
        isArchived
          ? 'bg-muted text-muted-foreground'
          : !timeStatus
            ? 'bg-muted/50 text-muted-foreground/70'
            : timeStatus.status === 'ended'
              ? 'bg-muted text-muted-foreground'
              : timeStatus.status === 'upcoming'
                ? 'bg-blue-500/15 text-blue-400'
                : 'bg-success-text/15 text-success-text',
      ]"
    >
      <template v-if="isArchived">
        <ArchiveIcon class="mr-1 size-3" />
        {{ $t('budgets.list.archivedLabel') }}
      </template>
      <template v-else>
        {{ timeStatus?.text || $t('budgets.list.noTimePeriod') }}
      </template>
    </div>

    <div class="relative flex flex-1 flex-col p-4">
      <BudgetCardDropdown
        :budget-id="budget.id"
        :is-archived="isArchived"
        @edit="emit('edit')"
        @delete="emit('delete')"
        @archive="emit('archive')"
      />
      <!-- Header -->
      <div class="mb-3 flex items-center gap-3">
        <div class="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
          <TagsIcon class="text-muted-foreground size-5" />
        </div>
        <div class="mt-auto min-w-0 flex-1">
          <h3 class="truncate pr-8 font-medium">{{ budget.name }}</h3>
          <div class="text-muted-foreground flex items-center gap-2 text-sm">
            <span v-if="budget.limitAmount">{{
              $t('budgets.list.limitLabel', { amount: formatBaseCurrency(budget.limitAmount) })
            }}</span>
            <span v-if="budget.limitAmount && budget.categories?.length">·</span>
            <span v-if="budget.categories?.length">
              {{ $t('budgets.list.categoriesCount', { count: budget.categories.length }) }}
            </span>
          </div>
        </div>
      </div>

      <!-- Category chips -->
      <div v-if="budget.categories?.length" class="mb-3 flex flex-wrap gap-1">
        <span
          v-for="category in budget.categories.slice(0, 4)"
          :key="category.id"
          class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
          :style="{ backgroundColor: category.color + '20', color: category.color }"
        >
          <CategoryCircle :category="category" class="size-2" />
          {{ category.name }}
        </span>
        <span
          v-if="budget.categories.length > 4"
          class="text-muted-foreground bg-muted rounded-full px-2 py-0.5 text-xs"
        >
          +{{ budget.categories.length - 4 }}
        </span>
      </div>

      <!-- Date range -->
      <div class="text-muted-foreground mb-3 flex items-center gap-2 text-xs">
        <template v-if="budget.startDate || budget.endDate">
          <div class="flex items-center gap-1.5">
            <CalendarIcon class="size-3.5" />
            <span v-if="budget.startDate && budget.endDate">
              {{ formatDate(budget.startDate) }}
              <ArrowRightIcon class="inline size-3" />
              {{ formatDate(budget.endDate) }}
            </span>
            <span v-else-if="budget.startDate">
              {{ formatDate(budget.startDate) }}
            </span>
            <span v-else-if="budget.endDate">
              {{ formatDate(budget.endDate) }}
            </span>
          </div>
        </template>
        <template v-else>
          <span class="text-muted-foreground/60 italic">{{ $t('budgets.list.autoTracked') }}</span>
        </template>
      </div>

      <!-- Stats -->
      <BudgetStatsSkeleton v-if="isStatsLoading" :show-utilization="!!budget.limitAmount" />
      <template v-else>
        <BudgetCardStats
          :income="stats?.actualIncome ?? 0"
          :expense="stats?.actualExpense ?? 0"
          :balance="stats?.balance ?? 0"
        />
        <BudgetCardUtilization v-if="budget.limitAmount" :utilization-rate="stats?.utilizationRate ?? 0" />
      </template>
    </div>
  </Card>
</template>
