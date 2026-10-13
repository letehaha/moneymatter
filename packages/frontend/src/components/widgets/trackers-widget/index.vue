<script lang="ts" setup>
import { loadBudgetStats, loadSystemBudgets } from '@/api/budgets';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { buttonVariants } from '@/components/lib/ui/button';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable/formatters';
import { cn } from '@/lib/utils';
import { utilizationClasses } from '@/pages/budgets/budget-list-cards/shared/utilization-classes';
import { ROUTES_NAMES } from '@/routes/constants';
import { useRootStore } from '@/stores';
import { BUDGET_STATUSES } from '@bt/shared/types';
import { ArrowUpRightIcon, TagsIcon } from '@lucide/vue';
import { useQueries, useQuery } from '@tanstack/vue-query';
import { isPast } from 'date-fns';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';

import ErrorState from '../components/error-state.vue';
import WidgetWrapper from '../components/widget-wrapper.vue';
import { sortTrackerRows } from './tracker-rows';

const { isAppInitialized } = storeToRefs(useRootStore());
const { formatBaseCurrency } = useFormatCurrency();

const SKELETON_ROWS = 4;

const listQuery = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.budgetsList, BUDGET_STATUSES.active],
  queryFn: () => loadSystemBudgets({ status: BUDGET_STATUSES.active }),
  enabled: isAppInitialized,
});

const trackers = computed(() => listQuery.data.value ?? []);

const statsQueries = useQueries({
  queries: computed(() =>
    trackers.value.map((tracker) => ({
      queryKey: [...VUE_QUERY_CACHE_KEYS.budgetStats, tracker.id],
      queryFn: () => loadBudgetStats({ budgetId: tracker.id }),
    })),
  ),
});

const rows = computed(() =>
  sortTrackerRows({
    rows: trackers.value.flatMap((tracker, index) => {
      const summary = statsQueries.value[index]?.data?.summary;
      if (!summary) return [];
      const utilizationRate = tracker.limitAmount ? (summary.utilizationRate ?? 0) : null;
      return [
        {
          tracker,
          summary,
          utilizationRate,
          ended: !!tracker.endDate && isPast(new Date(tracker.endDate)),
          tone: utilizationClasses({ rate: utilizationRate ?? 0 }),
        },
      ];
    }),
  }),
);

const isFetching = computed(() => listQuery.isFetching.value || statsQueries.value.some((query) => query.isFetching));
const isLoading = computed(() => listQuery.isPending.value || statsQueries.value.some((query) => query.isPending));
const isError = computed(() => listQuery.isError.value || statsQueries.value.some((query) => query.isError));

const retry = () => {
  if (listQuery.isError.value) void listQuery.refetch();
  for (const query of statsQueries.value) if (query.isError) void query.refetch();
};
</script>

<template>
  <WidgetWrapper class="max-md:max-h-96" :is-fetching="isFetching" data-testid="widget-trackers">
    <template #title>{{ $t('dashboard.widgets.registry.trackers.name') }}</template>
    <template #action>
      <DesktopOnlyTooltip :content="$t('common.actions.viewAll')">
        <span class="inline-flex">
          <router-link
            :class="buttonVariants({ variant: 'ghost', size: 'icon-sm', class: 'text-muted-foreground' })"
            :to="{ name: ROUTES_NAMES.plannedBudgets }"
            :aria-label="$t('common.actions.viewAll')"
          >
            <ArrowUpRightIcon class="size-4" />
          </router-link>
        </span>
      </DesktopOnlyTooltip>
    </template>

    <ErrorState v-if="isError" :message="$t('errors.api.unexpectedError')" @retry="retry" />

    <div v-else-if="isLoading" class="animate-pulse" aria-hidden="true">
      <div v-for="row in SKELETON_ROWS" :key="row" class="grid gap-2 py-2">
        <div class="flex items-center justify-between gap-3">
          <div class="bg-muted h-4 w-28 rounded" />
          <div class="bg-muted h-4 w-10 rounded" />
        </div>
        <div class="bg-muted h-1.5 rounded-full" />
        <div class="flex items-center justify-between gap-3">
          <div class="bg-muted h-3 w-24 rounded" />
          <div class="bg-muted h-3 w-16 rounded" />
        </div>
      </div>
    </div>

    <div v-else-if="!rows.length" class="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
      <TagsIcon class="text-muted-foreground size-10" />
      <p class="text-muted-foreground text-sm">{{ $t('dashboard.widgets.trackers.empty') }}</p>
      <router-link
        :class="buttonVariants({ variant: 'outline', size: 'sm' })"
        :to="{ name: ROUTES_NAMES.plannedBudgets }"
      >
        {{ $t('dashboard.widgets.trackers.create') }}
      </router-link>
    </div>

    <ScrollArea v-else class="-mx-2 min-h-0 flex-1" viewport-class="px-2 md:overscroll-contain-if-scrollable">
      <div class="divide-border/60 divide-y">
        <router-link
          v-for="row in rows"
          :key="row.tracker.id"
          :to="{ name: ROUTES_NAMES.plannedBudgetDetails, params: { id: row.tracker.id } }"
          :class="
            cn('hover:bg-foreground/5 -mx-2 block rounded-md px-2 py-2 transition-colors', row.ended && 'opacity-60')
          "
        >
          <span class="flex min-w-0 items-baseline justify-between gap-3">
            <span class="flex min-w-0 items-baseline gap-2">
              <span class="min-w-0 truncate text-sm font-semibold">{{ row.tracker.name }}</span>
              <span v-if="row.ended" class="text-muted-foreground shrink-0 text-xs">
                {{ $t('dashboard.widgets.trackers.ended') }}
              </span>
            </span>
            <span
              v-if="row.utilizationRate !== null"
              :class="cn('shrink-0 text-sm font-semibold tabular-nums', row.tone.text)"
            >
              {{ Math.round(row.utilizationRate) }}%
            </span>
            <span v-else class="text-muted-foreground shrink-0 text-xs">
              {{ $t('dashboard.widgets.trackers.noLimit') }}
            </span>
          </span>

          <span v-if="row.utilizationRate !== null" class="bg-muted mt-1.5 block h-1.5 overflow-hidden rounded-full">
            <span
              :class="cn('block h-full rounded-full', row.tone.bg)"
              :style="{ width: `${Math.min(row.utilizationRate, 100)}%` }"
            />
          </span>

          <span class="text-muted-foreground mt-1 flex justify-between gap-3 text-xs leading-4 tabular-nums">
            <span class="min-w-0 truncate">
              {{
                row.utilizationRate !== null
                  ? $t('dashboard.widgets.trackers.spentOfLimit', {
                      spent: formatBaseCurrency(row.summary.actualExpense),
                      limit: formatBaseCurrency(row.tracker.limitAmount ?? 0),
                    })
                  : $t('dashboard.widgets.trackers.inOut', {
                      income: formatBaseCurrency(row.summary.actualIncome),
                      expense: formatBaseCurrency(row.summary.actualExpense),
                    })
              }}
            </span>
            <span class="shrink-0">
              {{ $t('dashboard.widgets.trackers.net') }}
              <span
                :class="cn('font-semibold', row.summary.balance >= 0 ? 'text-success-text' : 'text-app-expense-color')"
              >
                {{ formatBaseCurrency(row.summary.balance) }}
              </span>
            </span>
          </span>
        </router-link>
      </div>
    </ScrollArea>
  </WidgetWrapper>
</template>
