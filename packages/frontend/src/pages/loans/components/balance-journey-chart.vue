<template>
  <div class="@container/loan-journey flex flex-col gap-4">
    <div v-if="withTitle" class="flex items-center gap-1.5 text-base font-semibold">
      {{ $t('loans.detail.paidOff.chart.title') }}
      <HintIcon :content="$t('loans.detail.paidOff.chart.titleHint')" />
    </div>

    <div v-if="isLoading" class="bg-muted h-72 w-full animate-pulse rounded @sm/loan-journey:h-80" />

    <div v-else-if="!hasAnyLine" class="text-muted-foreground py-8 text-center text-sm">
      {{ $t('loans.detail.paidOff.chart.noData') }}
    </div>

    <template v-else>
      <div ref="containerRef" class="relative h-72 w-full @sm/loan-journey:h-80">
        <svg ref="svgRef" class="h-full w-full"></svg>

        <div
          v-show="tooltip.visible"
          ref="tooltipRef"
          class="pointer-events-none absolute z-10"
          :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
        >
          <ChartTooltip>
            <ChartTooltipHeader>{{ tooltip.dateLabel }}</ChartTooltipHeader>
            <ChartTooltipRow
              v-for="entry in tooltip.entries"
              :key="entry.key"
              :color="entry.color"
              :label="entry.label"
            >
              <template #value>
                {{ entry.paidOff ? $t('loans.detail.payoffChart.paidOffShort') : formatCurrency(entry.value) }}
              </template>
            </ChartTooltipRow>
          </ChartTooltip>
        </div>
      </div>

      <!-- Legend: green actual line + muted dashed original schedule (schedule row hidden on fallback). -->
      <div class="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs">
        <div class="flex items-center gap-2">
          <span class="bg-app-income-color inline-block h-0.5 w-5 rounded-full"></span>
          <span class="text-muted-foreground">{{ $t('loans.detail.payoffChart.legend.actual') }}</span>
        </div>
        <div v-if="hasScheduleLine" class="flex items-center gap-2">
          <span class="border-muted-foreground inline-block w-5 border-t-2 border-dashed"></span>
          <span class="text-muted-foreground">{{ $t('loans.detail.payoffChart.legend.schedule') }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { type LoanApi, getLoanBalanceHistory } from '@/api/loans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { currentTheme } from '@/common/utils/color-theme';
import { ChartTooltip, ChartTooltipHeader, ChartTooltipRow } from '@/components/common/charts/chart-tooltip';
import HintIcon from '@/components/common/hint-icon.vue';
import { formatAxisCurrency } from '@/composable/charts/format-axis-currency';
import { useChartTooltipPosition } from '@/composable/charts/use-chart-tooltip-position';
import { useFormatCurrency } from '@/composable/formatters';
import { useDateLocale } from '@/composable/use-date-locale';
import { getCurrencyDecimals } from '@/js/helpers/currency-decimals';
import { useQuery } from '@tanstack/vue-query';
import { useResizeObserver } from '@vueuse/core';
import { parseISO } from 'date-fns';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { usePayoffChartRender } from '../composables/use-payoff-chart-render';
import { buildActualBalanceSeries } from '../utils/loan-balance-series';
import { type PayoffScenario, computeMinimumPaymentFromTerm, computePayoffScenario } from '../utils/payoff-schedule';

type LineKey = 'actual' | 'schedule';

const props = defineProps<{ loan: LoanApi; withTitle?: boolean }>();

const { t } = useI18n();
const { formatAmountByCurrencyCode, getCurrencySymbol } = useFormatCurrency();
const { format: formatDate } = useDateLocale();

const currencyCode = computed(() => props.loan.currencyCode);
const formatCurrency = (amount: number) => formatAmountByCurrencyCode(amount, currencyCode.value);
const currencySymbol = computed(() => getCurrencySymbol(currencyCode.value));

const startDate = computed(() => parseISO(props.loan.loanDetails.startDate));

// A `paid_off` event marks closure; on reopen-then-repay a later one is appended, so the last wins.
const closedDate = computed(() => {
  const paidOffEvents = props.loan.loanDetails.events.filter((event) => event.type === 'paid_off');
  const last = paidOffEvents.at(-1)?.at;
  return last ? parseISO(last) : new Date();
});

// Loan-currency series (anchor snapshot → per-payment-day points), so its values
// share units with `originalPrincipal` and the currency formatting below —
// the generic /stats/balance-history stores base-currency figures instead.
const balanceHistoryQuery = useQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.loanBalanceHistory, props.loan.id] as const),
  queryFn: () => getLoanBalanceHistory({ id: props.loan.id }),
  staleTime: 1000 * 60 * 5,
});

const isLoading = computed(() => balanceHistoryQuery.isLoading.value);

// Original contractual schedule: amortize the original principal over the term at the loan's APR,
// anchored at the start date. Absent when the loan has no term.
const scheduleScenario = computed<PayoffScenario | null>(() => {
  const { originalPrincipal, interestRate, termMonths } = props.loan.loanDetails;
  const decimals = getCurrencyDecimals({ code: props.loan.currencyCode });
  const payment = computeMinimumPaymentFromTerm({ principal: originalPrincipal, interestRate, termMonths, decimals });
  if (payment == null) return null;
  return computePayoffScenario({
    balance: originalPrincipal,
    interestRate,
    payment,
    today: startDate.value,
    decimals,
  });
});

// Real recorded balance, resampled monthly so it shares the schedule line's hover grid.
// `buildActualBalanceSeries` always yields a drawable opening-balance→0 series (an empty or
// failed balance-history fetch degrades to `data ?? []`, i.e. the pure opening-balance→0
// fallback), so a paid-off loan always gets its green line. `initialBalance` is the loan's
// opening tracked balance, stored negative per the liability convention — flip to a positive
// outstanding magnitude.
const actualScenario = computed<PayoffScenario>(() => {
  const points = buildActualBalanceSeries({
    history: balanceHistoryQuery.data.value ?? [],
    startDate: startDate.value,
    closedDate: closedDate.value,
    openingBalance: Math.abs(props.loan.initialBalance),
  });
  return {
    paysOff: true,
    monthsRemaining: points.length - 1,
    // Marker sits on the line's last point (a month-grid anchor, padded to one
    // month for same-month loans); the true close date only feeds the label.
    payoffDate: points.at(-1)!.date,
    totalInterest: null,
    points,
  };
});

const hasScheduleLine = computed(() => {
  const s = scheduleScenario.value;
  return !!s && s.paysOff && s.points.length > 1;
});

// Schedule first so it's the longer hover baseline (lines[0]); actual drawn last sits on top.
const renderableLines = computed(() => {
  const lines: Array<{ key: LineKey; dashed: boolean; scenario: PayoffScenario; displayPayoffDate?: Date }> = [];
  if (hasScheduleLine.value) lines.push({ key: 'schedule', dashed: true, scenario: scheduleScenario.value! });
  // `displayPayoffDate` keeps the "$0" marker labeled with the real close date even when the
  // plotted endpoint is padded onto the month grid.
  lines.push({
    key: 'actual',
    dashed: false,
    scenario: actualScenario.value,
    displayPayoffDate: closedDate.value,
  });
  return lines;
});

const hasAnyLine = computed(() => renderableLines.value.length > 0);

const containerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const tooltipRef = ref<HTMLDivElement | null>(null);

const tooltip = reactive({
  visible: false,
  x: 0,
  y: 0,
  dateLabel: '',
  entries: [] as Array<{ key: LineKey; color: string; label: string; value: number; paidOff: boolean }>,
});

const { updateTooltipPosition } = useChartTooltipPosition({ containerRef, tooltipRef, tooltip });

const formatAxisValue = (value: number) => formatAxisCurrency({ value, symbol: currencySymbol.value });

const { render } = usePayoffChartRender({
  svgRef,
  containerRef,
  // Anchor "now" on the start date so the retrospective x-axis spans open → close.
  renderableLines,
  today: startDate.value,
  tooltip,
  updateTooltipPosition,
  formatAxisValue,
  formatDate,
  t,
});

useResizeObserver(containerRef, render);
watch([renderableLines, currentTheme], render, { deep: true });
</script>
