<script setup lang="ts">
import type { SecurityLogoSource } from '@/common/utils/security-logo-url';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Card } from '@/components/lib/ui/card';
import { useHoldings } from '@/composable/data-queries/holdings';
import { usePortfolioAnalytics } from '@/composable/data-queries/portfolio-analytics';
import { cn } from '@/lib/utils';
import { ASSET_CLASS } from '@bt/shared/types/investments';
import { ChartPieIcon, TrendingDownIcon } from '@lucide/vue';
import { useLocalStorage } from '@vueuse/core';
import { computed, reactive, toRef } from 'vue';

import { getPeriodStartDate } from '../portfolio-hero/portfolio-hero-derivations';
import AllocationBreakdown from './allocation-breakdown.vue';
import AnalyticsBenchmarkPicker from './analytics-benchmark-picker.vue';
import { type AnalyticsPeriod, resolveBenchmark } from './analytics-derivations';
import AnalyticsKpis from './analytics-kpis.vue';
import AnalyticsPeriodPicker from './analytics-period-picker.vue';
import HoldingsReturnsTable from './holdings-returns-table.vue';
import MonthlyGainCard from './monthly-gain-card.vue';
import RelativePerformanceChart from './relative-performance-chart.vue';

const props = defineProps<{ portfolioId: string }>();

const periods = reactive<Record<'performance' | 'monthly', AnalyticsPeriod>>({ performance: '1Y', monthly: '1Y' });

const selectPeriod = ({
  card,
  period,
  applyToAll,
}: {
  card: keyof typeof periods;
  period: AnalyticsPeriod;
  applyToAll: boolean;
}) => {
  if (!applyToAll) {
    periods[card] = period;
    return;
  }
  periods.performance = period;
  periods.monthly = period;
};

const storedBenchmark = useLocalStorage<string | null>(
  () => `portfolio-analytics:benchmark:${props.portfolioId}`,
  null,
);
const benchmark = computed({
  get: () => resolveBenchmark({ stored: storedBenchmark.value }),
  set: (value) => (storedBenchmark.value = value),
});

const { data, isLoading, error, isPlaceholderData, refetch } = usePortfolioAnalytics({
  portfolioId: () => props.portfolioId,
  from: () => getPeriodStartDate({ period: periods.performance, today: new Date() }) ?? undefined,
  benchmark,
});

const { data: portfolioHoldings } = useHoldings(toRef(props, 'portfolioId'));

/** A holding whose security hasn't loaded yet gets a source with no logo, so its slot keeps its size. */
const logoSources = computed(() => {
  const securities = new Map(
    (portfolioHoldings.value ?? []).map((holding) => [holding.securityId, holding.security] as const),
  );
  return new Map<string, SecurityLogoSource>(
    (data.value?.holdings ?? []).map(({ securityId, symbol }) => [
      securityId,
      securities.get(securityId) ?? { symbol, assetClass: ASSET_CLASS.other },
    ]),
  );
});

const isEmpty = computed(
  () => data.value && data.value.portfolioReturnSeries.length === 0 && data.value.allocation.byHolding.length === 0,
);

const sectionTitle = 'text-base font-semibold';
const sectionCaption = 'text-muted-foreground text-sm';
</script>

<template>
  <div class="@container/analytics flex flex-col gap-4">
    <div
      v-if="error && !data"
      class="bg-card flex flex-col items-center gap-2 rounded-xl border p-6 text-center"
      role="alert"
    >
      <div class="bg-destructive/10 flex size-10 items-center justify-center rounded-full">
        <TrendingDownIcon class="text-destructive-text size-5" />
      </div>
      <p class="text-destructive-text text-sm">{{ $t('portfolioDetail.analytics.loadError') }}</p>
      <Button variant="outline" size="sm" @click="refetch()">{{ $t('common.actions.retry') }}</Button>
      <div class="mt-2 flex flex-wrap items-center justify-center gap-2">
        <AnalyticsBenchmarkPicker v-model="benchmark" />
        <AnalyticsPeriodPicker
          :model-value="periods.performance"
          @select="(selection) => selectPeriod({ card: 'performance', ...selection })"
        />
      </div>
    </div>

    <template v-else-if="isLoading">
      <div class="bg-muted h-120 animate-pulse rounded-xl" />
      <div class="bg-muted h-72 animate-pulse rounded-xl" />
      <div class="grid grid-cols-1 items-start gap-4 @3xl/analytics:grid-cols-5">
        <div class="bg-muted h-96 animate-pulse rounded-xl @3xl/analytics:col-span-3" />
        <div class="bg-muted h-80 animate-pulse rounded-xl @3xl/analytics:col-span-2" />
      </div>
    </template>

    <Card v-else-if="isEmpty" class="flex flex-col items-center px-4 py-12 text-center">
      <div class="bg-muted mb-4 flex size-12 items-center justify-center rounded-full">
        <ChartPieIcon class="text-muted-foreground size-6" />
      </div>
      <h3 class="mb-2 text-lg font-semibold">{{ $t('portfolioDetail.analytics.empty.title') }}</h3>
      <p class="text-muted-foreground max-w-md text-sm">{{ $t('portfolioDetail.analytics.empty.description') }}</p>
    </Card>

    <template v-else-if="data">
      <Card class="flex flex-col gap-3 p-4">
        <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div>
            <h2 :class="sectionTitle">{{ $t('portfolioDetail.analytics.relative.title') }}</h2>
            <p :class="sectionCaption">{{ $t('portfolioDetail.analytics.relative.caption') }}</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <AnalyticsBenchmarkPicker v-model="benchmark" />
            <AnalyticsPeriodPicker
              :model-value="periods.performance"
              @select="(selection) => selectPeriod({ card: 'performance', ...selection })"
            />
          </div>
        </div>

        <Callout v-if="error" variant="destructive" role="alert">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span>{{ $t('portfolioDetail.analytics.refreshError') }}</span>
            <Button variant="outline" size="xs" @click="refetch()">{{ $t('common.actions.retry') }}</Button>
          </div>
        </Callout>

        <div
          :class="cn('flex flex-col gap-3 transition-opacity', isPlaceholderData && 'pointer-events-none opacity-60')"
        >
          <AnalyticsKpis :kpis="data.kpis" :currency-code="data.currencyCode" />
          <RelativePerformanceChart
            :portfolio-id="portfolioId"
            :holdings="data.holdings"
            :return-series="data.portfolioReturnSeries"
            :logo-sources="logoSources"
            :benchmark="data.benchmark"
          />
        </div>
      </Card>

      <Card v-if="data.holdings.length" class="overflow-hidden pt-4 pb-3">
        <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pb-3">
          <h2 :class="sectionTitle">{{ $t('portfolioDetail.analytics.table.title') }}</h2>
          <p :class="sectionCaption">{{ $t('portfolioDetail.analytics.table.caption') }}</p>
        </div>
        <HoldingsReturnsTable
          :portfolio-id="portfolioId"
          :holdings="data.holdings"
          :currency-code="data.currencyCode"
          :logo-sources="logoSources"
        />
      </Card>

      <div class="grid grid-cols-1 items-start gap-4 @3xl/analytics:grid-cols-5">
        <Card class="min-w-0 p-4 @3xl/analytics:col-span-3">
          <AllocationBreakdown
            :allocation="data.allocation"
            :holdings="data.holdings"
            :currency-code="data.currencyCode"
            :logo-sources="logoSources"
          />
        </Card>

        <MonthlyGainCard
          class="@3xl/analytics:col-span-2"
          :portfolio-id="portfolioId"
          :period="periods.monthly"
          :benchmark="benchmark"
          @select="(selection) => selectPeriod({ card: 'monthly', ...selection })"
        />
      </div>
    </template>
  </div>
</template>
