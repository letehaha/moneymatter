<script lang="ts" setup>
import { useFormatCurrency } from '@/composable/formatters';
import { useAnimatedNumber } from '@/composable/use-animated-number';
import { calculatePercentageDifference } from '@/js/helpers/math/calculate-percentage-difference';
import ExcludeCategoriesMenu from '@/components/common/category-exclusions/exclude-categories-menu.vue';
import ExcludedCountBadge from '@/components/common/category-exclusions/excluded-count-badge.vue';
import { useCategoryExclusionsConfig } from '@/components/common/category-exclusions/use-category-exclusions-config';
import { ChartTooltipHeader } from '@/components/common/charts/chart-tooltip';
import FitAmount from '@/components/common/fit-amount.vue';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import { buttonVariants } from '@/components/lib/ui/button';
import { Switch } from '@/components/lib/ui/switch';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import {
  AVERAGE_LINE_COLOR,
  AVERAGE_LINE_SHADOW_COLOR,
  AVERAGE_LINE_SHADOW_WIDTH,
} from '@/composable/charts/render-average-line';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import IncludePlannedMenuItem from '@/components/widgets/components/include-planned-menu-item.vue';
import { useIncludePlannedConfig, useWidgetConfigFlag } from '@/components/widgets/use-include-planned-config';
import { format, isFuture, isSameMonth, parseISO } from 'date-fns';
import { ArrowDownRightIcon, ArrowUpRightIcon, InfoIcon, WalletIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import EmptyState from '../components/empty-state.vue';
import LoadingState from '../components/loading-state.vue';
import WidgetWrapper from '../components/widget-wrapper.vue';
import { buildSavingsRateLine, computeSavingsRate } from './helpers';
import { useCashFlowData } from './use-cash-flow-data';

defineOptions({ name: 'cash-flow-widget' });

const props = defineProps<{
  selectedPeriod: { from: Date; to: Date };
}>();

const { formatBaseCurrency } = useFormatCurrency();

const { widgetConfigRef, excludedCategoryIds, persistExcludedCategories } = useCategoryExclusionsConfig();
const { includePlanned } = useIncludePlannedConfig();

const { t } = useI18n();
const { isOn: showSavingsRateLine, setFlag: setShowSavingsRateLine } = useWidgetConfigFlag({
  key: 'showSavingsRateLine',
  saveErrorKey: 'errors.api.unexpectedError',
});

const onToggleSavingsRateLine = async (value: boolean) => {
  await setShowSavingsRateLine({ value });
};

const {
  currentTotals,
  prevNetFlow,
  trendPeriods,
  unionPeriods,
  hasCurrentData,
  hasPrevData,
  isFetching,
  isInitialLoading,
  isCurrentEmpty,
  isEmpty,
} = useCashFlowData({ selectedPeriod: () => props.selectedPeriod, excludedCategoryIds, includePlanned });

const income = computed(() => currentTotals.value.income);
const expenses = computed(() => currentTotals.value.expenses);
const netFlow = computed(() => currentTotals.value.netFlow);
const savingsRate = computed(() => currentTotals.value.savingsRate);

const { displayValue: animatedIncome } = useAnimatedNumber({ value: income });
const { displayValue: animatedExpenses } = useAnimatedNumber({ value: expenses });
const { displayValue: animatedNetFlow } = useAnimatedNumber({ value: netFlow });

// Flow bar proportions. Either side can be negative — a period whose refunds outweigh its purchases
// reports negative expenses — so the bar compares magnitudes.
const flowBarTotal = computed(() => Math.abs(income.value) + Math.abs(expenses.value));

const incomePercent = computed(() => {
  if (flowBarTotal.value === 0) return 50;
  return Math.max(5, (Math.abs(income.value) / flowBarTotal.value) * 100);
});

const expensePercent = computed(() => {
  if (flowBarTotal.value === 0) return 50;
  return Math.max(5, (Math.abs(expenses.value) / flowBarTotal.value) * 100);
});

// Percentage change vs previous period
const netFlowDiff = computed(() => Number(calculatePercentageDifference(netFlow.value, prevNetFlow.value).toFixed(1)));

const periodLabel = computed(() => {
  const { from, to } = props.selectedPeriod;
  if (isSameMonth(from, to)) {
    return format(from, 'MMMM yyyy');
  }
  return `${format(from, 'MMM d')} - ${format(to, 'MMM d, yyyy')}`;
});

const isPositiveFlow = computed(() => netFlow.value >= 0);

const trendBuckets = computed(() => {
  const apiPeriods = unionPeriods.value;

  // Past periods come from the union response; the current period uses currentTotals.
  if (!apiPeriods.length && !hasCurrentData.value) return [];

  return trendPeriods.value.map((bucket) => {
    if (bucket.isCurrent) {
      return { ...bucket, income: income.value, netFlow: netFlow.value };
    }

    const totals = { income: 0, netFlow: 0 };
    for (const ap of apiPeriods) {
      const apStart = parseISO(ap.periodStart);
      if (apStart >= bucket.from && apStart <= bucket.to) {
        totals.income += ap.income;
        totals.netFlow += ap.netFlow;
      }
    }

    return { ...bucket, ...totals };
  });
});

const savingsLine = computed(() =>
  buildSavingsRateLine({ buckets: trendBuckets.value.map((p) => ({ ...p, isInProgress: isFuture(p.to) })) }),
);

const trendBars = computed(() => {
  const maxAbs = Math.max(...trendBuckets.value.map((p) => Math.abs(p.netFlow)), 1);

  return trendBuckets.value.map((p) => {
    const isSingleMonth = isSameMonth(p.from, p.to);
    const label = isSingleMonth ? format(p.from, 'MMM') : `${format(p.from, 'MMM d')} - ${format(p.to, 'MMM d')}`;
    const shortLabel = isSingleMonth ? format(p.from, 'MMM') : format(p.from, 'MMM yy');

    return {
      label,
      shortLabel,
      value: p.netFlow,
      heightPercent: (Math.abs(p.netFlow) / maxAbs) * 100,
      isPositive: p.netFlow >= 0,
      isCurrent: p.isCurrent,
      formatted: formatBaseCurrency(p.netFlow),
      savingsRate: computeSavingsRate({ income: p.income, netFlow: p.netFlow }),
    };
  });
});

// A label this close to the top edge would leave the plot, so it flips below its point.
const SAVINGS_LABEL_FLIP_Y_PERCENT = 24;

const savingsLineLabel = computed(() => {
  const point = showSavingsRateLine.value && savingsLine.value.points.findLast((p) => p !== null);
  if (!point) return null;

  return {
    point,
    text: point.rate === null ? t('dashboard.widgets.cashFlow.noIncome') : `${point.rate}%`,
    isBelow: point.yPercent < SAVINGS_LABEL_FLIP_Y_PERCENT,
  };
});
</script>

<template>
  <WidgetWrapper :is-fetching="isFetching">
    <template #title>
      <span class="inline-flex items-center gap-1">
        {{ $t('dashboard.widgets.cashFlow.title') }}

        <ResponsiveTooltip
          :content="$t('dashboard.widgets.cashFlow.description')"
          content-class-name="max-w-56"
          :delay-duration="100"
        >
          <InfoIcon class="text-muted-foreground ml-1 size-4 cursor-help" />
        </ResponsiveTooltip>

        <ExcludedCountBadge
          v-if="excludedCategoryIds.length"
          :count="excludedCategoryIds.length"
          test-id="cf-excluded-badge"
        />
      </span>
    </template>

    <template v-if="widgetConfigRef" #action>
      <DesktopOnlyTooltip v-if="!isEmpty && !isInitialLoading" :content="$t('dashboard.widgets.cashFlow.viewDetails')">
        <span class="inline-flex">
          <router-link
            :class="buttonVariants({ variant: 'ghost', size: 'icon-sm', class: 'text-muted-foreground' })"
            :to="{ name: ROUTES_NAMES.analyticsCashFlow }"
            :aria-label="$t('dashboard.widgets.cashFlow.viewDetails')"
          >
            <ArrowUpRightIcon class="size-4" />
          </router-link>
        </span>
      </DesktopOnlyTooltip>

      <ExcludeCategoriesMenu
        :excluded-category-ids="excludedCategoryIds"
        test-id-prefix="cf"
        @save="persistExcludedCategories"
      >
        <IncludePlannedMenuItem test-id-prefix="cf" />
        <div class="flex items-center justify-between gap-2 rounded-md px-2 py-2">
          <span class="text-sm font-medium">{{ $t('dashboard.widgets.cashFlow.savingsRateLine') }}</span>
          <Switch
            class="shrink-0"
            :model-value="showSavingsRateLine"
            data-testid="cf-savings-rate-line-switch"
            @update:model-value="onToggleSavingsRateLine"
          />
        </div>
      </ExcludeCategoriesMenu>
    </template>

    <template v-if="isInitialLoading">
      <LoadingState />
    </template>

    <template v-else-if="isEmpty && !isFetching">
      <EmptyState>
        <WalletIcon class="size-32" />
      </EmptyState>
    </template>

    <template v-else>
      <div class="flex h-full flex-col gap-3">
        <!-- Header: net flow amount + period -->
        <div class="mb-4">
          <div class="flex items-start justify-between gap-2">
            <div>
              <p
                class="text-2xl font-bold tracking-tight"
                :class="isPositiveFlow ? 'text-app-income-color' : 'text-app-expense-color'"
              >
                {{ isPositiveFlow ? '+' : '' }}{{ formatBaseCurrency(animatedNetFlow) }}
              </p>
              <p class="text-muted-foreground mt-0.5 text-xs font-medium tracking-tight uppercase">
                {{ periodLabel }}
              </p>
            </div>

            <!-- Comparison badge -->
            <div v-if="hasPrevData" class="flex flex-col items-end gap-0.5">
              <span
                v-if="isCurrentEmpty"
                class="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
              >
                {{ $t('dashboard.widgets.cashFlow.notAvailable') }}
              </span>
              <span
                v-else
                class="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold"
                :class="{
                  'bg-success-text/15 text-success-text': netFlowDiff > 0,
                  'bg-destructive-text/15 text-destructive-text': netFlowDiff < 0,
                  'bg-muted text-muted-foreground': netFlowDiff === 0,
                }"
              >
                <ArrowUpRightIcon v-if="netFlowDiff > 0" class="size-3" />
                <ArrowDownRightIcon v-else-if="netFlowDiff < 0" class="size-3" />
                {{ netFlowDiff > 0 ? '+' : '' }}{{ netFlowDiff }}%
              </span>
              <span class="text-muted-foreground text-[10px]">
                {{ $t('dashboard.widgets.cashFlow.vsPrevious') }}
              </span>
            </div>
          </div>
        </div>

        <!-- Flow bar visualization -->
        <div>
          <div class="bg-muted flex h-3 w-full overflow-hidden rounded-full">
            <template v-if="flowBarTotal > 0">
              <div
                class="bg-app-income-color transition-all duration-500 ease-out"
                :style="{ width: `${incomePercent}%` }"
              />
              <div class="bg-muted w-px shrink-0" />
              <div
                class="bg-app-expense-color transition-all duration-500 ease-out"
                :style="{ width: `${expensePercent}%` }"
              />
            </template>
          </div>
        </div>

        <!-- Stats grid -->
        <div class="grid grid-cols-3 gap-3">
          <!-- Income -->
          <div class="rounded-lg border p-3">
            <div class="text-muted-foreground mb-1 text-[11px] font-medium tracking-wider uppercase">
              {{ $t('dashboard.widgets.cashFlow.income') }}
            </div>
            <FitAmount :value="animatedIncome" :target="income" class="text-app-income-color text-amount text-sm" />
          </div>

          <!-- Expenses -->
          <div class="rounded-lg border p-3">
            <div class="text-muted-foreground mb-1 text-[11px] font-medium tracking-wider uppercase">
              {{ $t('dashboard.widgets.cashFlow.expenses') }}
            </div>
            <FitAmount
              :value="animatedExpenses"
              :target="expenses"
              class="text-app-expense-color text-amount text-sm"
            />
          </div>

          <!-- Savings rate -->
          <div class="rounded-lg border p-3">
            <div class="text-muted-foreground mb-1 text-[11px] font-medium tracking-wider uppercase">
              {{ $t('dashboard.widgets.cashFlow.saved') }}
            </div>
            <div
              class="text-amount text-sm"
              :class="savingsRate >= 0 ? 'text-app-income-color' : 'text-app-expense-color'"
            >
              {{ savingsRate }}%
            </div>
          </div>
        </div>

        <!-- Trend mini bars -->
        <div v-if="trendBars.length" class="mt-auto flex flex-col gap-1.5">
          <div class="text-muted-foreground flex items-center justify-between gap-2 text-[11px] font-medium">
            <span class="truncate tracking-wider uppercase">
              {{ $t('dashboard.widgets.cashFlow.previousPeriodsTrend') }}
            </span>
            <span v-if="savingsLineLabel" class="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
              <span class="w-4 border-t-2 border-dotted" :style="{ borderColor: AVERAGE_LINE_COLOR }" />
              {{ $t('dashboard.widgets.cashFlow.savingsRate') }}
            </span>
          </div>
          <!-- Columns are spaced with padding, not a flex gap, so their centres land on the line's x positions. -->
          <div class="relative flex h-25 items-end">
            <ResponsiveTooltip
              v-for="(bar, index) in trendBars"
              :key="index"
              variant="chart"
              content-class-name="min-w-0"
              :delay-duration="100"
            >
              <div class="flex flex-1 flex-col items-center gap-1 px-1.25">
                <div class="flex h-22 w-full max-w-10 items-end justify-center">
                  <div
                    class="min-h-1 w-full rounded-xs transition-all duration-500"
                    :class="{
                      'bg-muted': bar.value === 0,
                      'bg-app-income-color/90': bar.value > 0,
                      'bg-app-expense-color/90': bar.value < 0,
                    }"
                    :style="{ height: `${Math.max(bar.heightPercent, 4)}%` }"
                  />
                </div>
                <span class="text-muted-foreground text-[9px] leading-none">{{ bar.shortLabel }}</span>
              </div>
              <template #content>
                <ChartTooltipHeader>{{ bar.label }}</ChartTooltipHeader>
                <div
                  class="font-semibold whitespace-nowrap tabular-nums"
                  :class="bar.isPositive ? 'text-app-income-color' : 'text-app-expense-color'"
                >
                  {{ bar.formatted }}
                </div>
                <div
                  v-if="showSavingsRateLine"
                  class="text-muted-foreground mt-1 flex items-center justify-between gap-3 text-xs whitespace-nowrap"
                >
                  {{ $t('dashboard.widgets.cashFlow.savingsRate') }}
                  <span v-if="bar.savingsRate === null">{{ $t('dashboard.widgets.cashFlow.noIncome') }}</span>
                  <span
                    v-else
                    class="font-semibold tabular-nums"
                    :class="bar.savingsRate >= 0 ? 'text-app-income-color' : 'text-app-expense-color'"
                  >
                    {{ bar.savingsRate }}%
                  </span>
                </div>
              </template>
            </ResponsiveTooltip>

            <div
              v-if="savingsLineLabel"
              class="pointer-events-none absolute inset-x-0 top-0 h-22"
              :style="{ color: AVERAGE_LINE_COLOR }"
            >
              <div
                v-if="savingsLine.zeroYPercent !== null"
                class="border-border absolute inset-x-0 border-t border-dashed"
                :style="{ top: `${savingsLine.zeroYPercent}%` }"
              />
              <svg
                class="absolute inset-0 size-full overflow-visible"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <template v-for="segment in savingsLine.segments" :key="segment">
                  <polyline
                    :points="segment"
                    fill="none"
                    :stroke="AVERAGE_LINE_SHADOW_COLOR"
                    :stroke-width="AVERAGE_LINE_SHADOW_WIDTH"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    vector-effect="non-scaling-stroke"
                  />
                  <polyline
                    :points="segment"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-dasharray="0.1 5"
                    stroke-linecap="round"
                    vector-effect="non-scaling-stroke"
                  />
                </template>
              </svg>
              <template v-for="(point, index) in savingsLine.points" :key="index">
                <span
                  v-if="point"
                  :class="
                    cn(
                      'ring-card absolute size-1.75 -translate-1/2 rounded-full ring-2',
                      point.isOffScale ? 'bg-card border border-current' : 'bg-current',
                    )
                  "
                  :style="{ left: `${point.xPercent}%`, top: `${point.yPercent}%` }"
                />
              </template>
              <span
                :class="
                  cn(
                    'bg-card text-warning-text absolute -translate-x-1/2 rounded-sm border px-1 py-0.5 text-[10px] leading-none font-bold whitespace-nowrap tabular-nums',
                    savingsLineLabel.isBelow ? 'mt-2' : '-mt-2 -translate-y-full',
                  )
                "
                :style="{ left: `${savingsLineLabel.point.xPercent}%`, top: `${savingsLineLabel.point.yPercent}%` }"
              >
                {{ savingsLineLabel.text }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </WidgetWrapper>
</template>
