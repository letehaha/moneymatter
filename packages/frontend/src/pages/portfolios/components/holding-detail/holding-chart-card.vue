<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Card } from '@/components/lib/ui/card';
import { PillTabs } from '@/components/lib/ui/pill-tabs';
import { getGainColorClass } from '@/composable/gain-color';
import { cn } from '@/lib/utils';
import type { HoldingModel } from '@bt/shared/types/investments';
import { useLocalStorage } from '@vueuse/core';
import { computed, reactive } from 'vue';
import { useI18n } from 'vue-i18n';

import { toOptionalNumber, useHeroFormat } from '../portfolio-hero/use-hero-format';
import { usePeriodLabels } from '../portfolio-hero/use-period-labels';
import {
  HOLDING_CHART_PERIODS,
  type HoldingChartPeriod,
  type PricePoint,
  type Trade,
  slicePricePoints,
} from './holding-derivations';
import HoldingPriceChart from './holding-price-chart.vue';

const props = defineProps<{
  holding: HoldingModel;
  points: PricePoint[];
  trades: Trade[];
  isLoading: boolean;
  isError: boolean;
  isTradesError: boolean;
  averageCost: number | null;
}>();

const emit = defineEmits<{ retryPrices: []; retryTrades: [] }>();

const { t } = useI18n();
const { formatMoney, formatSignedMoney, formatPercent } = useHeroFormat({
  currencyCode: () => props.holding.currencyCode,
});

const CHART_HEIGHT_PX = 320;

const storedPeriod = useLocalStorage<HoldingChartPeriod>('portfolio:holding-chart-period', '1Y');
const period = computed<HoldingChartPeriod>({
  get: () => (HOLDING_CHART_PERIODS.includes(storedPeriod.value) ? storedPeriod.value : '1Y'),
  set: (value) => (storedPeriod.value = value),
});
const series = reactive({ buys: true, sells: true, averageCost: true });

const periodLabels = usePeriodLabels();
const periodItems = computed(() => HOLDING_CHART_PERIODS.map((value) => ({ value, label: periodLabels.value[value] })));

const visiblePoints = computed(() =>
  slicePricePoints({ points: props.points, period: period.value, today: new Date() }),
);

const unrealized = computed(() => toOptionalNumber({ value: props.holding.unrealizedGainValue }));
const unrealizedPct = computed(() => toOptionalNumber({ value: props.holding.unrealizedGainPercent }));

const legend = computed(() => [
  { key: 'buys' as const, label: t('portfolioHolding.chart.buys'), swatch: 'bg-app-income-color h-3 rounded-full' },
  { key: 'sells' as const, label: t('portfolioHolding.chart.sells'), swatch: 'bg-app-expense-color h-3 rounded-xs' },
  ...(props.averageCost === null
    ? []
    : [
        {
          key: 'averageCost' as const,
          label: t('portfolioHolding.stats.averageCost'),
          swatch: 'border-warning-text border-t-2 border-dashed',
        },
      ]),
]);
</script>

<template>
  <Card class="flex min-w-0 flex-col gap-3 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          {{ $t('portfolioDetail.holdingsTable.headers.marketValue') }}
        </p>
        <p class="text-2xl font-bold tracking-tight tabular-nums">
          {{ formatMoney({ amount: toOptionalNumber({ value: holding.marketValue }) }) }}
        </p>
        <p class="flex flex-wrap items-baseline gap-x-2 text-sm tabular-nums">
          <span :class="cn('font-semibold', getGainColorClass({ gainValue: unrealized ?? 0 }))">
            {{ formatSignedMoney({ amount: unrealized }) }} ({{
              formatPercent({ fraction: unrealizedPct === null ? null : unrealizedPct / 100 })
            }})
          </span>
          <span class="text-muted-foreground">{{ $t('portfolioHolding.chart.unrealizedCaption') }}</span>
        </p>
      </div>
      <PillTabs
        :model-value="period"
        :items="periodItems"
        @update:model-value="(value) => (period = value as HoldingChartPeriod)"
      />
    </div>

    <div v-if="isLoading" class="bg-muted animate-pulse rounded-lg" :style="{ height: `${CHART_HEIGHT_PX}px` }" />
    <div
      v-else-if="isError"
      class="text-muted-foreground flex flex-col items-center justify-center gap-3 text-center text-sm"
      :style="{ height: `${CHART_HEIGHT_PX}px` }"
      role="alert"
    >
      {{ $t('portfolioHolding.chart.loadError') }}
      <Button variant="outline" size="sm" @click="emit('retryPrices')">{{ $t('common.actions.retry') }}</Button>
    </div>
    <div
      v-else-if="visiblePoints.length === 0"
      class="text-muted-foreground flex items-center justify-center text-center text-sm"
      :style="{ height: `${CHART_HEIGHT_PX}px` }"
    >
      {{ $t('portfolioHolding.chart.empty') }}
    </div>
    <HoldingPriceChart
      v-else
      :points="visiblePoints"
      :trades="trades"
      :average-cost="averageCost"
      :currency-code="holding.currencyCode"
      :series="series"
      :height="CHART_HEIGHT_PX"
    />
    <p v-if="isTradesError && !isLoading" class="text-muted-foreground flex flex-wrap items-center gap-x-2 text-sm">
      {{ $t('portfolioHolding.chart.tradesError') }}
      <Button variant="link" size="sm" class="h-auto p-0" @click="emit('retryTrades')">
        {{ $t('common.actions.retry') }}
      </Button>
    </p>

    <div class="flex flex-wrap gap-2 border-t pt-3">
      <Button
        v-for="item in legend"
        :key="item.key"
        variant="outline"
        size="sm"
        :aria-pressed="series[item.key]"
        :class="cn(!series[item.key] && 'text-muted-foreground')"
        @click="series[item.key] = !series[item.key]"
      >
        <span :class="cn('inline-block w-3', item.swatch, !series[item.key] && 'opacity-40')" />
        {{ item.label }}
      </Button>
    </div>
  </Card>
</template>
