<template>
  <div class="border-border bg-card flex flex-col rounded-lg border p-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 class="text-lg font-semibold">{{ t('analytics.trends.transactionsCard.title') }}</h3>
      <div class="flex items-center gap-2">
        <Loader2Icon v-if="isFetching" class="text-muted-foreground size-4 animate-spin" />
        <PillTabs
          size="sm"
          :items="sortItems"
          :model-value="sortMode"
          @update:model-value="(value) => (sortMode = value as SortMode)"
        />
      </div>
    </div>

    <div v-if="isLoading" class="space-y-2">
      <div v-for="index in 5" :key="index" class="bg-muted h-12 animate-pulse rounded-md" />
    </div>
    <div v-else-if="isError" class="text-destructive-text flex h-32 items-center justify-center text-sm">
      {{ t('analytics.trends.loadError') }}
    </div>
    <div v-else-if="!transactions?.length" class="text-muted-foreground flex h-32 items-center justify-center text-sm">
      {{ t('analytics.trends.noData') }}
    </div>
    <ScrollArea
      v-else
      class="-mx-2 px-2 @5xl/trends:max-h-[calc(100vh-var(--header-height)-7rem)]"
      viewport-class="@5xl/trends:max-h-[calc(100vh-var(--header-height)-7rem)]"
    >
      <TransactionsList :transactions="transactions" :paginate="false" raw-list disable-grouping />
    </ScrollArea>
  </div>
</template>

<script setup lang="ts">
import { loadTransactions } from '@/api/transactions';
import { QUERY_CACHE_STALE_TIME, VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { type MetricType } from '@/common/utils/analytics-metric';
import { type PillTabItem, PillTabs } from '@/components/lib/ui/pill-tabs';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import TransactionsList from '@/components/transactions-list/transactions-list.vue';
import { type Period } from '@/composable/use-period-navigation';
import { useCategoriesStore } from '@/stores';
import { SORT_DIRECTIONS, TRANSACTION_SORT_FIELD } from '@bt/shared/types';
import { Loader2Icon } from '@lucide/vue';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { useSessionStorage } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { createEnumSerializer } from '../../../utils';
import { type TrendsFilters, toTransactionFilterParams } from '../trends-filters';

const LIMIT = 20;
const SORT_MODES = ['largest', 'recent'] as const;
type SortMode = (typeof SORT_MODES)[number];

const props = defineProps<{
  filters: TrendsFilters;
  period: Period;
  metric: MetricType;
}>();

const { t } = useI18n();

const sortMode = useSessionStorage<SortMode>('trends-transactions-sort', 'largest', {
  serializer: createEnumSerializer({ values: SORT_MODES, fallback: 'largest' }),
});
const sortItems = computed<PillTabItem[]>(() => [
  { value: 'largest', label: t('analytics.trends.transactionsCard.largest') },
  { value: 'recent', label: t('analytics.trends.transactionsCard.recent') },
]);
const { categories } = storeToRefs(useCategoriesStore());

// ponytail: the transactions endpoint has no excluded-payee param, so an excluded payee still shows here.
const queryParams = computed(() => {
  const { payees, tags } = props.filters;
  return {
    from: props.period.from.toISOString(),
    to: props.period.to.toISOString(),
    ...toTransactionFilterParams({ filters: props.filters, categories: categories.value, metric: props.metric }),
    excludeTransfer: true,
    sortBy: sortMode.value === 'recent' ? TRANSACTION_SORT_FIELD.time : TRANSACTION_SORT_FIELD.refAmount,
    order: SORT_DIRECTIONS.desc,
    limit: LIMIT,
    ...(payees.mode === 'include' && payees.ids.length && { payeeIds: payees.ids }),
    ...(tags.ids.length && (tags.mode === 'include' ? { tagIds: tags.ids } : { excludedTagIds: tags.ids })),
  };
});

const {
  data: transactions,
  isLoading,
  isFetching,
  isError,
} = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.analyticsLargestTransactions, queryParams],
  queryFn: () => loadTransactions(queryParams.value),
  staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
  placeholderData: keepPreviousData,
});
</script>
