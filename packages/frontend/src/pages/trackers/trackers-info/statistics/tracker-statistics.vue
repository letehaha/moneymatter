<script setup lang="ts">
import { loadTrackerSpendingStats } from '@/api/trackers';
import BrandLogo from '@/components/common/brand-logo.vue';
import { toEntityLogoDisplayProps } from '@/components/common/logo-selection';
import CurrencyLabel from '@/components/common/currency-label.vue';
import { QUERY_CACHE_STALE_TIME, VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useFormatCurrency } from '@/composable';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import { useCurrenciesStore } from '@/stores';
import type { TrackerModel, TrackerStatsResponse } from '@bt/shared/types';
import { BarChart3Icon, TriangleAlertIcon } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { sumBy } from 'lodash-es';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { parseTrackerDate } from '../../tracker-time-status';
import { getTrackerSpent } from '../tracker-summary';
import TrackerTimelineChart from './tracker-timeline-chart.vue';
import {
  getAveragePerDay,
  getCategorySplits,
  getCumulativeSeries,
  getPercent,
  getPeriodProgress,
  getTrackerPace,
} from './tracker-insights';

const props = defineProps<{
  tracker: TrackerModel;
  stats: TrackerStatsResponse | undefined;
}>();

const { t } = useI18n();
const { format } = useDateLocale();
const { formatWholeOrCompactAmount, formatSignedWholeOrCompactAmount, formatCompactAmount } = useFormatCurrency();
const { baseCurrency } = storeToRefs(useCurrenciesStore());

const trackerId = computed(() => props.tracker.id);

const { data, isLoading, isError } = useQuery({
  queryFn: () => loadTrackerSpendingStats({ trackerId: trackerId.value }),
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.trackerSpendingStats, trackerId.value]),
  staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
});

const isEmpty = computed(
  () => !!data.value && data.value.spendingsByCategory.length === 0 && data.value.spendingOverTime.periods.length === 0,
);

const series = computed(() => getCumulativeSeries({ periods: data.value?.spendingOverTime.periods ?? [] }));
// The timeline is clipped to the tracker window, so linked rows outside it only show up in the overall total.
const expense = computed(() => props.stats?.summary.actualExpense ?? sumBy(series.value, 'expense'));
const spent = computed(() =>
  props.stats ? getTrackerSpent({ summary: props.stats.summary }) : (series.value.at(-1)?.cumulative ?? 0),
);
const baseCode = computed(() => baseCurrency.value?.currency?.code ?? '');
const formatBaseCurrency = (amount: number) => formatCompactAmount(amount, baseCode.value);
const formatWholeBaseCurrency = (amount: number) =>
  formatWholeOrCompactAmount({ amount, currencyCode: baseCode.value });
const limit = computed(() => props.tracker.limitAmount || null);
const progress = computed(() =>
  getPeriodProgress({ startDate: props.tracker.startDate, endDate: props.tracker.endDate }),
);
const pace = computed(() => getTrackerPace({ spent: spent.value, limit: limit.value, progress: progress.value }));

const rangeStart = computed(() => progress.value?.start ?? null);
const rangeEnd = computed(() => progress.value?.end ?? null);

const formatDate = ({ value, pattern }: { value: string | Date | null | undefined; pattern: string }) => {
  const date = parseTrackerDate(value);
  return date ? format(date, pattern) : '—';
};
const formatDay = (value: string | Date) => formatDate({ value, pattern: 'MMM d' });
const formatFullDate = (value: string | null | undefined) => formatDate({ value, pattern: 'MMM d, yyyy' });

interface KpiCell {
  key: string;
  label: string;
  value: string;
  suffix?: string;
  sub?: string;
  valueClass?: string;
}

const paceCell = computed<KpiCell>(() => {
  const summary = props.stats?.summary;
  if (!progress.value) {
    return {
      key: 'first',
      label: t('pages.budgetDetails.statistics.kpi.firstTransaction'),
      value: formatFullDate(summary?.firstTransactionDate),
    };
  }
  const { dailyPace, allowedPerDay } = pace.value;
  const days = { elapsed: progress.value.elapsedDays, total: progress.value.totalDays };
  return {
    key: 'pace',
    label: t('pages.budgetDetails.statistics.kpi.dailyPace'),
    value: dailyPace === null ? '—' : formatWholeBaseCurrency(dailyPace),
    suffix: dailyPace === null ? undefined : t('pages.budgetDetails.statistics.kpi.perDay'),
    sub:
      allowedPerDay === null
        ? t('pages.budgetDetails.statistics.kpi.daysElapsed', days)
        : t('pages.budgetDetails.statistics.kpi.allowedPerDay', {
            amount: formatWholeBaseCurrency(allowedPerDay),
            ...days,
          }),
    valueClass: allowedPerDay !== null && dailyPace !== null && dailyPace > allowedPerDay ? 'text-warning-text' : '',
  };
});

const projectionCell = computed<KpiCell>(() => {
  const summary = props.stats?.summary;
  if (!progress.value) {
    return {
      key: 'last',
      label: t('pages.budgetDetails.statistics.kpi.lastTransaction'),
      value: formatFullDate(summary?.lastTransactionDate),
    };
  }
  if (!limit.value) {
    const average = getAveragePerDay({
      spent: spent.value,
      firstDate: summary?.firstTransactionDate,
      lastDate: summary?.lastTransactionDate,
    });
    return {
      key: 'average',
      label: t('pages.budgetDetails.statistics.kpi.averagePerDay'),
      value: average === null ? '—' : formatWholeBaseCurrency(average),
      sub:
        summary?.firstTransactionDate && summary.lastTransactionDate
          ? `${formatDay(summary.firstTransactionDate)} – ${formatDay(summary.lastTransactionDate)}`
          : undefined,
    };
  }
  const { projectedTotal, projectedDelta } = pace.value;
  return {
    key: 'projection',
    label: t('pages.budgetDetails.statistics.kpi.projectedTotal'),
    value: projectedTotal === null ? '—' : formatWholeBaseCurrency(projectedTotal),
    suffix:
      projectedDelta === null
        ? undefined
        : formatSignedWholeOrCompactAmount({ amount: projectedDelta, currencyCode: baseCode.value }),
    sub: t('pages.budgetDetails.statistics.kpi.projectedLimit', { amount: formatWholeBaseCurrency(limit.value) }),
    valueClass: projectedDelta === null ? '' : projectedDelta > 0 ? 'text-destructive-text' : 'text-success-text',
  };
});

const kpis = computed<KpiCell[]>(() => {
  const count = props.stats?.summary.transactionsCount;
  const biggestDay = data.value?.biggestDay;
  return [
    paceCell.value,
    projectionCell.value,
    {
      key: 'transactions',
      label: t('pages.budgetDetails.statistics.kpi.transactions'),
      value: count === undefined ? '—' : String(count),
      suffix: count
        ? t('pages.budgetDetails.statistics.kpi.avgAmount', { amount: formatWholeBaseCurrency(expense.value / count) })
        : undefined,
    },
    {
      key: 'biggestDay',
      label: t('pages.budgetDetails.statistics.kpi.biggestDay'),
      value: biggestDay ? formatWholeBaseCurrency(biggestDay.expense) : '—',
      suffix: biggestDay ? formatDay(biggestDay.date) : undefined,
      sub: biggestDay
        ? t('pages.budgetDetails.statistics.kpi.shareOfTotal', {
            percent: Math.round(getPercent({ part: biggestDay.expense, total: expense.value })),
          })
        : undefined,
    },
  ];
});

const categorySplits = computed(() => getCategorySplits({ items: data.value?.spendingsByCategory ?? [] }));

const timelineCaption = computed(() => {
  const first = series.value[0];
  const last = series.value.at(-1);
  const start = rangeStart.value ?? parseTrackerDate(first?.periodStart);
  const end = rangeEnd.value ?? parseTrackerDate(last?.periodEnd);
  if (!start || !end) return '';
  const range = `${formatDay(start)} – ${formatDay(end)}`;
  return progress.value?.isActive
    ? `${range} · ${t('pages.budgetDetails.statistics.todayMarker', { date: formatDay(new Date()) })}`
    : range;
});

const showProjection = computed(() => !!limit.value && !!progress.value?.isActive);
</script>

<template>
  <div v-if="isLoading" class="@container/stats overflow-hidden" aria-busy="true">
    <div class="bg-border grid grid-cols-1 gap-px border-b @md/stats:grid-cols-4">
      <div
        v-for="i in 4"
        :key="i"
        class="bg-card flex items-center justify-between gap-3 px-4 py-2.5 @md/stats:block @md/stats:space-y-2 @md/stats:py-3"
      >
        <div class="bg-muted h-3.5 w-16 animate-pulse rounded" />
        <div class="bg-muted h-5 w-20 animate-pulse rounded @md/stats:h-7" />
        <div class="bg-muted hidden h-3.5 w-24 animate-pulse rounded @md/stats:block" />
      </div>
    </div>
    <div class="grid @lg/stats:grid-cols-2">
      <div class="space-y-3 p-4">
        <div class="bg-muted h-3.5 w-24 animate-pulse rounded" />
        <div v-for="i in 4" :key="i" class="bg-muted h-5 animate-pulse rounded" />
      </div>
      <div class="space-y-3 p-4 @lg/stats:border-l">
        <div class="bg-muted h-3.5 w-24 animate-pulse rounded" />
        <div class="bg-muted h-64 animate-pulse rounded" />
      </div>
    </div>
  </div>

  <div v-else-if="isError" class="flex flex-col items-center justify-center py-12 text-center">
    <div class="bg-muted mb-4 flex size-16 items-center justify-center rounded-full">
      <TriangleAlertIcon class="text-muted-foreground size-8" />
    </div>
    <h3 class="mb-1 font-medium">{{ $t('pages.budgetDetails.statistics.errorTitle') }}</h3>
    <p class="text-muted-foreground max-w-sm text-sm">{{ $t('pages.budgetDetails.statistics.errorDescription') }}</p>
  </div>

  <div v-else-if="isEmpty" class="flex flex-col items-center justify-center py-12 text-center">
    <div class="bg-muted mb-4 flex size-16 items-center justify-center rounded-full">
      <BarChart3Icon class="text-muted-foreground size-8" />
    </div>
    <h3 class="mb-1 font-medium">{{ $t('pages.budgetDetails.statistics.noDataTitle') }}</h3>
    <p class="text-muted-foreground max-w-sm text-sm">{{ $t('pages.budgetDetails.statistics.noDataDescription') }}</p>
  </div>

  <div v-else-if="data" class="@container/stats overflow-hidden tabular-nums">
    <div class="bg-border grid grid-cols-1 gap-px @md/stats:grid-cols-4">
      <div
        v-for="kpi in kpis"
        :key="kpi.key"
        class="bg-card flex min-w-0 items-baseline justify-between gap-3 px-4 py-2.5 @md/stats:block @md/stats:py-3"
      >
        <div
          class="text-muted-foreground min-w-0 truncate text-xs font-medium @md/stats:text-sm @md/stats:tracking-wide @md/stats:uppercase"
        >
          {{ kpi.label }}
        </div>
        <div class="flex shrink-0 flex-wrap items-baseline justify-end gap-x-1.5 @md/stats:block">
          <div :class="cn('truncate text-base font-bold @md/stats:mt-0.5 @md/stats:text-xl', kpi.valueClass)">
            {{ kpi.value }}
            <small v-if="kpi.suffix" class="text-muted-foreground ml-1 text-sm font-medium">{{ kpi.suffix }}</small>
          </div>
          <div v-if="kpi.sub" class="text-muted-foreground hidden truncate text-sm @sm/stats:block @md/stats:mt-0.5">
            <span class="@md/stats:hidden">· </span>{{ kpi.sub }}
          </div>
        </div>
      </div>
    </div>

    <div class="flex flex-col border-t @lg/stats:grid @lg/stats:grid-cols-2">
      <div class="contents @lg/stats:block @lg/stats:min-w-0">
        <section class="order-2 border-t p-4 @lg/stats:border-t-0">
          <h3 class="mb-2.5 flex items-baseline gap-2 text-sm font-bold">
            {{ $t('pages.budgetDetails.statistics.byCategory') }}
            <span class="text-muted-foreground ml-auto text-sm font-medium">
              {{ formatBaseCurrency(categorySplits.total) }} ·
              {{
                $t(
                  'pages.budgetDetails.statistics.categoriesCount',
                  { count: categorySplits.items.length },
                  categorySplits.items.length,
                )
              }}
            </span>
          </h3>
          <div
            v-for="item in categorySplits.items"
            :key="item.categoryId"
            class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 py-1.5 text-sm @md/stats:grid-cols-[minmax(0,3fr)_minmax(0,2fr)_auto]"
          >
            <div class="flex min-w-0 items-center gap-2">
              <i class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: item.color }" />
              <span class="truncate">{{ item.name }}</span>
            </div>
            <div class="text-right font-semibold whitespace-nowrap @md/stats:order-2">
              {{ formatBaseCurrency(item.amount) }}
              <span class="text-muted-foreground ml-1 font-medium">{{ Math.round(item.percent) }}%</span>
            </div>
            <div class="bg-muted col-span-2 h-2 overflow-hidden rounded-full @md/stats:order-1 @md/stats:col-span-1">
              <div class="h-full rounded-full" :style="{ width: `${item.percent}%`, backgroundColor: item.color }" />
            </div>
          </div>
        </section>

        <section
          v-if="data.spendingsByCurrency.length"
          class="order-4 border-t p-4 @lg/stats:border-t-0 @lg/stats:pt-0"
        >
          <h3 class="mb-2.5 flex items-baseline gap-2 text-sm font-bold">
            {{ $t('pages.budgetDetails.statistics.byCurrency') }}
            <span class="text-muted-foreground ml-auto text-sm font-medium">
              {{ $t('pages.budgetDetails.statistics.asPaid') }}
            </span>
          </h3>
          <div
            v-for="row in data.spendingsByCurrency"
            :key="row.currencyCode"
            class="flex items-center justify-between gap-2.5 py-1.5 text-sm"
          >
            <CurrencyLabel :code="row.currencyCode" />
            <span class="font-semibold whitespace-nowrap">
              {{ formatCompactAmount(row.amount, row.currencyCode) }}
              <span
                v-if="row.currencyCode !== baseCurrency?.currency?.code"
                class="text-muted-foreground ml-1 font-medium"
              >
                ≈ {{ formatBaseCurrency(row.refAmount) }}
              </span>
            </span>
          </div>
        </section>
      </div>

      <div class="contents @lg/stats:block @lg/stats:min-w-0 @lg/stats:border-l">
        <section class="order-1 p-4">
          <h3 class="mb-2.5 flex items-baseline gap-2 text-sm font-bold">
            {{ $t('pages.budgetDetails.statistics.timeline') }}
            <span class="text-muted-foreground ml-auto truncate text-sm font-medium">{{ timelineCaption }}</span>
          </h3>
          <TrackerTimelineChart
            v-if="series.length"
            :series="series"
            :granularity="data.spendingOverTime.granularity"
            :range-start="rangeStart"
            :range-end="rangeEnd"
            :limit="progress ? limit : null"
            :projected-total="showProjection ? pace.projectedTotal : null"
          />
          <p v-else class="text-muted-foreground py-12 text-center text-sm">
            {{ $t('pages.budgetDetails.statistics.noTimelineData') }}
          </p>
        </section>

        <section v-if="data.topPayees.length" class="order-3 border-t p-4 @lg/stats:border-t-0 @lg/stats:pt-0">
          <h3 class="mb-2.5 flex items-baseline gap-2 text-sm font-bold">
            {{ $t('pages.budgetDetails.statistics.topPayees') }}
            <span class="text-muted-foreground ml-auto text-sm font-medium">
              {{ $t('pages.budgetDetails.statistics.bySpend') }}
            </span>
          </h3>
          <div
            v-for="payee in data.topPayees"
            :key="payee.payeeId ?? 'none'"
            class="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-2.5 py-1.5 text-sm"
          >
            <BrandLogo
              v-if="payee.name"
              v-bind="toEntityLogoDisplayProps(payee)"
              :name="payee.name"
              class="size-5 rounded-full"
            />
            <span
              v-else
              class="bg-muted text-muted-foreground grid size-5 place-items-center rounded-full text-sm font-bold"
            >
              –
            </span>
            <div class="truncate">
              <span class="font-bold">{{ payee.name ?? $t('pages.budgetDetails.statistics.noPayee') }}</span>
              <span class="text-muted-foreground">
                · {{ $t('pages.budgetDetails.statistics.txCount', { count: payee.transactionsCount }) }}
              </span>
            </div>
            <div class="text-right font-semibold whitespace-nowrap">
              {{ formatBaseCurrency(payee.amount) }}
              <span class="text-muted-foreground ml-1 font-medium">
                {{ Math.round(getPercent({ part: payee.amount, total: expense })) }}%
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
