<script setup lang="ts">
import { getCombinedBalanceHistory } from '@/api/stats';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { useFormatCurrency } from '@/composable/formatters';
import { useBaseBalanceTotals } from '@/composable/use-base-balance-totals';
import { captureException } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import { useAccountsStore, useRootStore } from '@/stores';
import { ScaleIcon } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { useScroll } from '@vueuse/core';
import { format } from 'date-fns';
import { storeToRefs } from 'pinia';
import { computed, ref, useTemplateRef, watch } from 'vue';

import EmptyState from '../components/empty-state.vue';
import ErrorState from '../components/error-state.vue';
import LoadingState from '../components/loading-state.vue';
import WidgetWrapper from '../components/widget-wrapper.vue';
import { type Bucket, type BucketKey, computeAssetsLiabilities, formatShareLabel } from './helpers';

const BUCKETS: Record<BucketKey, { colorClass: string; labelKey: string }> = {
  investments: { colorClass: 'bg-primary', labelKey: 'dashboard.widgets.assetsLiabilities.buckets.investments' },
  cash: { colorClass: 'bg-app-income-color', labelKey: 'dashboard.widgets.assetsLiabilities.buckets.cash' },
  ventures: { colorClass: 'bg-warning', labelKey: 'dashboard.widgets.assetsLiabilities.buckets.ventures' },
  vehicles: { colorClass: 'bg-muted-foreground', labelKey: 'dashboard.widgets.assetsLiabilities.buckets.vehicles' },
  loans: { colorClass: 'bg-app-expense-color', labelKey: 'dashboard.widgets.assetsLiabilities.buckets.loans' },
  creditAndOverdrafts: {
    colorClass: 'bg-app-expense-color/55',
    labelKey: 'dashboard.widgets.assetsLiabilities.buckets.creditAndOverdrafts',
  },
};

const { isAppInitialized } = storeToRefs(useRootStore());
const accountsStore = useAccountsStore();
const { accounts, isAccountsFetched, isAccountsError } = storeToRefs(accountsStore);
const { baseCurrencyCode, includeCreditLimit } = useBaseBalanceTotals();
const { formatBaseCurrency } = useFormatCurrency();

const today = new Date();
const { data, isFetching, isError, error, refetch } = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.widgetAssetsLiabilities, format(today, 'yyyy-MM-dd'), includeCreditLimit],
  queryFn: () => getCombinedBalanceHistory({ from: today, to: today }),
  staleTime: Infinity,
  enabled: isAppInitialized,
});

watch(error, (value) => {
  if (value) captureException({ error: value, context: { scope: 'assets-liabilities-widget:load' } });
});

// Archived accounts stay in: the server's accountsBalance counts them too.
const summary = computed(() => {
  const point = data.value?.at(-1);
  if (!point) return null;
  return computeAssetsLiabilities({
    point,
    accounts: accounts.value ?? [],
    includeCreditLimit: includeCreditLimit.value,
  });
});

const assetsTotal = computed(() => summary.value?.assetsTotal ?? 0);
const liabilitiesTotal = computed(() => summary.value?.liabilitiesTotal ?? 0);
const netWorth = computed(() => summary.value?.netWorth ?? 0);
const isUnderwater = computed(() => netWorth.value < 0);
const scale = computed(() => Math.max(assetsTotal.value, liabilitiesTotal.value));

const gapStyle = computed(() => {
  const color = isUnderwater.value ? 'var(--app-expense-color)' : 'var(--app-income-color)';
  return {
    background: `repeating-linear-gradient(135deg, ${color} 0 4px, color-mix(in srgb, ${color} 35%, var(--card)) 4px 8px)`,
  };
});

const barRows = computed(() => [
  {
    key: 'assets',
    labelKey: 'dashboard.widgets.assetsLiabilities.assets',
    total: assetsTotal.value,
    buckets: summary.value?.assets ?? [],
    showsNetWorth: isUnderwater.value,
    amountClass: 'text-foreground',
  },
  {
    key: 'liabilities',
    labelKey: 'dashboard.widgets.assetsLiabilities.liabilities',
    total: liabilitiesTotal.value,
    buckets: summary.value?.liabilities ?? [],
    showsNetWorth: !isUnderwater.value,
    amountClass: liabilitiesTotal.value > 0 ? 'text-app-expense-color' : 'text-foreground',
  },
]);

const legendRows = computed(() => {
  const toRow = ({ bucket, total }: { bucket: Bucket; total: number }) => ({
    ...bucket,
    share: formatShareLabel({ part: bucket.amount, total }),
  });
  return [
    ...(summary.value?.assets ?? []).map((bucket) => toRow({ bucket, total: assetsTotal.value })),
    ...(summary.value?.liabilities ?? []).map((bucket) => toRow({ bucket, total: liabilitiesTotal.value })),
  ];
});

const hoveredKey = ref<BucketKey | null>(null);

const isInitialLoading = computed(
  () =>
    (!data.value && (isFetching.value || !isAppInitialized.value)) ||
    !isAccountsFetched.value ||
    !baseCurrencyCode.value,
);
const isEmpty = computed(() => assetsTotal.value === 0 && liabilitiesTotal.value === 0);

const scrollAreaRef = useTemplateRef<InstanceType<typeof ScrollArea>>('scrollAreaRef');
const scrollRef = computed<HTMLElement | null>(() => scrollAreaRef.value?.viewportRef?.viewportElement ?? null);
const { arrivedState, measure } = useScroll(scrollRef);
// useScroll measures on mount and on scroll only, and the scroll area mounts after the data arrives.
watch([scrollRef, legendRows], () => measure(), { flush: 'post' });
</script>

<template>
  <WidgetWrapper class="max-md:max-h-96" :is-fetching="isFetching">
    <template #title>{{ $t('dashboard.widgets.registry.assetsLiabilities.name') }}</template>

    <template v-if="isInitialLoading">
      <LoadingState />
    </template>

    <template v-else-if="isError || isAccountsError">
      <ErrorState
        :message="$t('dashboard.widgets.assetsLiabilities.loadFailed')"
        @retry="
          refetch();
          accountsStore.refetchAccounts();
        "
      />
    </template>

    <template v-else-if="isEmpty">
      <EmptyState>
        <ScaleIcon class="size-32" />
      </EmptyState>
    </template>

    <div v-else class="flex min-h-0 flex-1 flex-col gap-3.5">
      <div>
        <p class="text-muted-foreground text-xs">{{ $t('dashboard.widgets.assetsLiabilities.netWorth') }}</p>
        <p :class="cn('text-2xl font-bold tracking-tight tabular-nums', isUnderwater && 'text-app-expense-color')">
          {{ formatBaseCurrency(netWorth) }}
        </p>
        <p v-if="liabilitiesTotal === 0" class="text-muted-foreground mt-0.5 text-xs">
          {{ $t('dashboard.widgets.assetsLiabilities.noDebt') }}
        </p>
        <i18n-t
          v-else-if="assetsTotal > 0"
          keypath="dashboard.widgets.assetsLiabilities.owesShare"
          tag="p"
          class="text-muted-foreground mt-0.5 text-xs"
        >
          <template #percent>
            <b class="text-foreground font-bold tabular-nums">
              {{ formatShareLabel({ part: liabilitiesTotal, total: assetsTotal }) }}
            </b>
          </template>
        </i18n-t>
      </div>

      <div class="flex flex-col gap-2.5">
        <div v-for="row in barRows" :key="row.key">
          <div class="mb-1 flex flex-wrap justify-between gap-x-2 text-xs">
            <span class="text-muted-foreground">
              {{ $t(row.labelKey) }}
              <b :class="cn('font-bold tabular-nums', row.amountClass)">{{ formatBaseCurrency(row.total) }}</b>
            </span>
            <span v-if="row.showsNetWorth" :class="isUnderwater ? 'text-app-expense-color' : 'text-app-income-color'">
              {{ $t('dashboard.widgets.assetsLiabilities.netWorth') }}
              <b class="font-bold tabular-nums">{{ formatBaseCurrency(netWorth) }}</b>
            </span>
          </div>

          <div class="flex h-3.5 gap-0.5" aria-hidden="true">
            <div
              v-if="row.total > 0"
              class="flex shrink-0 gap-0.5 overflow-hidden rounded"
              :style="{ width: `${(row.total / scale) * 100}%` }"
            >
              <span
                v-for="bucket in row.buckets"
                :key="bucket.key"
                :class="
                  cn(
                    'h-full shrink-0 transition-opacity',
                    BUCKETS[bucket.key].colorClass,
                    hoveredKey && hoveredKey !== bucket.key && 'opacity-30',
                  )
                "
                :style="{ width: `max(2px, calc(${(bucket.amount / row.total) * 100}% - 2px))` }"
              />
            </div>
            <span v-if="row.showsNetWorth" class="min-w-0 flex-1 rounded" :style="gapStyle" />
          </div>
        </div>
      </div>

      <ScrollArea
        ref="scrollAreaRef"
        :class="
          cn(
            '-mx-2 min-h-0 flex-1',
            !arrivedState.bottom && 'mask-[linear-gradient(to_bottom,black_calc(100%-1.75rem),transparent)]',
          )
        "
        viewport-class="px-2 md:overscroll-contain-if-scrollable"
      >
        <div class="-mx-2 flex flex-col pb-1">
          <div
            v-for="row in legendRows"
            :key="row.key"
            class="hover:bg-hover grid grid-cols-[8px_minmax(0,1fr)_auto_auto] items-center gap-2.5 rounded-md px-2 py-1 text-sm transition-colors"
            @mouseenter="hoveredKey = row.key"
            @mouseleave="hoveredKey = null"
          >
            <span :class="cn('size-2 rounded-sm', BUCKETS[row.key].colorClass)" />
            <span class="truncate font-medium">{{ $t(BUCKETS[row.key].labelKey) }}</span>
            <span class="text-muted-foreground min-w-7.5 text-right text-xs tabular-nums">{{ row.share }}</span>
            <span class="text-right font-semibold tabular-nums">{{ formatBaseCurrency(row.amount) }}</span>
          </div>
        </div>
      </ScrollArea>
    </div>
  </WidgetWrapper>
</template>
