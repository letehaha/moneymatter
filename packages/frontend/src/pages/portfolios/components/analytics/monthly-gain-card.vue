<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Card } from '@/components/lib/ui/card';
import { usePortfolioAnalytics } from '@/composable/data-queries/portfolio-analytics';
import { getGainColorClass } from '@/composable/gain-color';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import type { PortfolioBenchmark } from '@bt/shared/types/investments';
import { parseISO } from 'date-fns';
import { computed } from 'vue';

import { getPeriodStartDate } from '../portfolio-hero/portfolio-hero-derivations';
import { useHeroFormat } from '../portfolio-hero/use-hero-format';
import { usePeriodLabels } from '../portfolio-hero/use-period-labels';
import { type AnalyticsPeriod, summarizeMonthlyGain } from './analytics-derivations';
import AnalyticsPeriodPicker from './analytics-period-picker.vue';
import MonthlyGainChart from './monthly-gain-chart.vue';

const props = defineProps<{ portfolioId: string; period: AnalyticsPeriod; benchmark: PortfolioBenchmark | null }>();

const emit = defineEmits<{ select: [selection: { period: AnalyticsPeriod; applyToAll: boolean }] }>();

const { format } = useDateLocale();
const periodLabels = usePeriodLabels();

const { data, isLoading, error, isPlaceholderData, refetch } = usePortfolioAnalytics({
  portfolioId: () => props.portfolioId,
  from: () => getPeriodStartDate({ period: props.period, today: new Date() }) ?? undefined,
  benchmark: () => props.benchmark,
});

const { formatSignedMoney } = useHeroFormat({ currencyCode: () => data.value?.currencyCode ?? '' });

const monthly = computed(() => summarizeMonthlyGain({ months: data.value?.monthlyMarketGain ?? [] }));

const formatMonth = ({ month }: { month: string }) => format(parseISO(`${month}-01`), 'MMM yyyy');
</script>

<template>
  <Card class="flex min-w-0 flex-col gap-3 p-4">
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 class="text-base font-semibold">{{ $t('portfolioDetail.analytics.monthly.title') }}</h2>
        <i18n-t
          v-if="monthly"
          keypath="portfolioDetail.analytics.monthly.caption"
          tag="p"
          class="text-muted-foreground text-sm"
        >
          <template #period>{{ periodLabels[period] }}</template>
          <template #total>
            <span :class="cn('font-semibold tabular-nums', getGainColorClass({ gainValue: monthly.total }))">
              {{ formatSignedMoney({ amount: monthly.total }) }}
            </span>
          </template>
        </i18n-t>
      </div>
      <AnalyticsPeriodPicker :model-value="period" @select="(selection) => emit('select', selection)" />
    </div>

    <div v-if="isLoading" class="bg-muted h-55 animate-pulse rounded-lg" />

    <div v-else-if="error && !data" class="flex flex-col items-center gap-2 py-6 text-center" role="alert">
      <p class="text-destructive-text text-sm">{{ $t('portfolioDetail.analytics.loadError') }}</p>
      <Button variant="outline" size="sm" @click="refetch()">{{ $t('common.actions.retry') }}</Button>
    </div>

    <div
      v-else-if="data"
      :class="cn('flex flex-col gap-3 transition-opacity', isPlaceholderData && 'pointer-events-none opacity-60')"
    >
      <Callout v-if="error" variant="destructive" role="alert">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span>{{ $t('portfolioDetail.analytics.refreshError') }}</span>
          <Button variant="outline" size="xs" @click="refetch()">{{ $t('common.actions.retry') }}</Button>
        </div>
      </Callout>

      <template v-if="monthly">
        <MonthlyGainChart :months="monthly.values" :currency-code="data.currencyCode" />
        <div
          v-if="monthly.values.length > 1"
          class="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t pt-3 text-sm"
        >
          <i18n-t keypath="portfolioDetail.analytics.monthly.best" tag="span" class="text-muted-foreground">
            <template #month>{{ formatMonth({ month: monthly.best.month }) }}</template>
            <template #amount>
              <span :class="cn('font-semibold tabular-nums', getGainColorClass({ gainValue: monthly.best.gain }))">
                {{ formatSignedMoney({ amount: monthly.best.gain }) }}
              </span>
            </template>
          </i18n-t>
          <i18n-t keypath="portfolioDetail.analytics.monthly.worst" tag="span" class="text-muted-foreground">
            <template #month>{{ formatMonth({ month: monthly.worst.month }) }}</template>
            <template #amount>
              <span :class="cn('font-semibold tabular-nums', getGainColorClass({ gainValue: monthly.worst.gain }))">
                {{ formatSignedMoney({ amount: monthly.worst.gain }) }}
              </span>
            </template>
          </i18n-t>
        </div>
      </template>
      <p v-else class="text-muted-foreground py-6 text-center text-sm">
        {{ $t('portfolioDetail.analytics.monthly.empty') }}
      </p>
    </div>
  </Card>
</template>
