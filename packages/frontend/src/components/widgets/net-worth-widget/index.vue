<script lang="ts" setup>
import { ChartTooltipHeader, ChartTooltipRow } from '@/components/common/charts/chart-tooltip';
import FitAmount from '@/components/common/fit-amount.vue';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import { buttonVariants } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable/formatters';
import { useAnimatedNumber } from '@/composable/use-animated-number';
import { calculatePercentageDifference } from '@/js/helpers/math/calculate-percentage-difference';
import { ROUTES_NAMES } from '@/routes/constants';
import { ArrowDownRightIcon, ArrowUpRightIcon, CircleOffIcon, InfoIcon, TrendingUpIcon } from '@lucide/vue';
import { format, isSameMonth } from 'date-fns';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import EmptyState from '../components/empty-state.vue';
import ErrorState from '../components/error-state.vue';
import LoadingState from '../components/loading-state.vue';
import WidgetWrapper from '../components/widget-wrapper.vue';
import { type NetWorthComponentKey, excludedComponents } from './helpers';
import NetWorthSettingsPopover from './net-worth-settings-popover.vue';
import { useNetWorthConfig } from './use-net-worth-config';
import { useNetWorthData } from './use-net-worth-data';

defineOptions({ name: 'net-worth-widget' });

const props = defineProps<{
  selectedPeriod: { from: Date; to: Date };
}>();

const COMPONENT_LABEL_KEYS: Record<NetWorthComponentKey, string> = {
  ventures: 'dashboard.widgets.netWorth.components.ventures',
  vehicles: 'dashboard.widgets.netWorth.components.vehicles',
  properties: 'dashboard.widgets.netWorth.components.properties',
  loans: 'dashboard.widgets.netWorth.components.loans',
};

const MIN_TREND_BAR_HEIGHT_PERCENT = 4;
const NO_VALUE_LABEL = '—';

const { t } = useI18n();
const { formatBaseCurrency } = useFormatCurrency();

const { widgetConfigRef, settings, persistSettings, isUpdating } = useNetWorthConfig();

const {
  startNetWorth,
  endNetWorth,
  currentDelta,
  prevDelta,
  growthPercent,
  trendWindows,
  isFetching,
  isInitialLoading,
  isEmpty,
  isError,
  refetch,
} = useNetWorthData({ selectedPeriod: () => props.selectedPeriod, settings });

const { displayValue: animatedDelta } = useAnimatedNumber({ value: computed(() => currentDelta.value ?? 0) });

const isPositiveDelta = computed(() => (currentDelta.value ?? 0) >= 0);

const hasComparison = computed(() => prevDelta.value.available && currentDelta.value !== null);

const deltaDiff = computed(() => {
  if (!prevDelta.value.available || currentDelta.value === null) return 0;
  return Number(calculatePercentageDifference(currentDelta.value, prevDelta.value.delta).toFixed(1));
});

const periodLabel = computed(() => {
  const { from, to } = props.selectedPeriod;
  if (isSameMonth(from, to)) {
    return format(from, 'MMMM yyyy');
  }
  return `${format(from, 'MMM d')} - ${format(to, 'MMM d, yyyy')}`;
});

const excludedNames = computed(() =>
  excludedComponents({ settings: settings.value }).map((key) => t(COMPONENT_LABEL_KEYS[key])),
);

const formattedDelta = computed(() => {
  if (currentDelta.value === null) return NO_VALUE_LABEL;
  return `${isPositiveDelta.value ? '+' : ''}${formatBaseCurrency(animatedDelta.value)}`;
});

const formattedGrowth = computed(() => {
  const percent = growthPercent.value;
  if (percent === null) return NO_VALUE_LABEL;
  return `${percent > 0 ? '+' : ''}${percent.toFixed(1)}%`;
});

const trendBars = computed(() => {
  const maxAbs = Math.max(...trendWindows.value.map((bar) => (bar.hasData ? Math.abs(bar.delta) : 0)), 1);

  return trendWindows.value.map((bar) => {
    if (!bar.hasData) {
      return {
        label: bar.label,
        shortLabel: bar.shortLabel,
        hasData: false,
        isPositive: false,
        heightPercent: MIN_TREND_BAR_HEIGHT_PERCENT,
        formattedDelta: '',
        formattedNetWorth: '',
      };
    }

    return {
      label: bar.label,
      shortLabel: bar.shortLabel,
      hasData: true,
      isPositive: bar.delta >= 0,
      heightPercent: Math.max((Math.abs(bar.delta) / maxAbs) * 100, MIN_TREND_BAR_HEIGHT_PERCENT),
      formattedDelta: `${bar.delta > 0 ? '+' : ''}${formatBaseCurrency(bar.delta)}`,
      formattedNetWorth: formatBaseCurrency(bar.endNetWorth),
    };
  });
});
</script>

<template>
  <WidgetWrapper :is-fetching="isFetching">
    <template #title>
      <span class="inline-flex items-center gap-1">
        {{ $t('dashboard.widgets.netWorth.title') }}

        <ResponsiveTooltip
          :content="$t('dashboard.widgets.netWorth.description')"
          content-class-name="max-w-56"
          :delay-duration="100"
        >
          <InfoIcon class="text-muted-foreground ml-1 size-4 cursor-help" />
        </ResponsiveTooltip>

        <ResponsiveTooltip
          v-if="excludedNames.length"
          :content="$t('dashboard.widgets.netWorth.excludedTooltip', { components: excludedNames.join(', ') })"
          content-class-name="max-w-56"
          :delay-duration="100"
        >
          <span
            class="bg-warning-text/15 text-warning-text inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold"
            data-testid="nw-excluded-badge"
          >
            <CircleOffIcon class="size-3" />
            {{ excludedNames.length }}
          </span>
        </ResponsiveTooltip>
      </span>
    </template>

    <template v-if="widgetConfigRef" #action>
      <DesktopOnlyTooltip
        v-if="!isEmpty && !isInitialLoading && !isError"
        :content="$t('dashboard.widgets.netWorth.viewHistory')"
      >
        <span class="inline-flex">
          <router-link
            :class="buttonVariants({ variant: 'ghost', size: 'icon-sm', class: 'text-muted-foreground' })"
            :to="{ name: ROUTES_NAMES.analyticsNetWorthHistory }"
            :aria-label="$t('dashboard.widgets.netWorth.viewHistory')"
          >
            <ArrowUpRightIcon class="size-4" />
          </router-link>
        </span>
      </DesktopOnlyTooltip>

      <NetWorthSettingsPopover :settings="settings" :is-updating="isUpdating" @save="persistSettings" />
    </template>

    <template v-if="isInitialLoading">
      <LoadingState />
    </template>

    <template v-else-if="isError">
      <ErrorState :message="$t('dashboard.widgets.netWorth.loadFailed')" @retry="refetch()" />
    </template>

    <template v-else-if="isEmpty && !isFetching">
      <EmptyState>
        <TrendingUpIcon class="size-32" />
      </EmptyState>
    </template>

    <template v-else>
      <div class="flex h-full flex-col gap-3">
        <div class="mb-4">
          <div class="flex items-start justify-between gap-2">
            <div>
              <p
                class="text-2xl font-bold tracking-tight"
                :class="{
                  'text-muted-foreground': currentDelta === null,
                  'text-app-income-color': currentDelta !== null && isPositiveDelta,
                  'text-app-expense-color': currentDelta !== null && !isPositiveDelta,
                }"
              >
                {{ formattedDelta }}
              </p>
              <p class="text-muted-foreground mt-0.5 text-xs font-medium tracking-tight uppercase">
                {{ periodLabel }}
              </p>
            </div>

            <div v-if="hasComparison" class="flex flex-col items-end gap-0.5">
              <span
                class="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold"
                :class="{
                  'bg-success-text/15 text-success-text': deltaDiff > 0,
                  'bg-destructive-text/15 text-destructive-text': deltaDiff < 0,
                  'bg-muted text-muted-foreground': deltaDiff === 0,
                }"
              >
                <ArrowUpRightIcon v-if="deltaDiff > 0" class="size-3" />
                <ArrowDownRightIcon v-else-if="deltaDiff < 0" class="size-3" />
                {{ deltaDiff > 0 ? '+' : '' }}{{ deltaDiff }}%
              </span>
              <span class="text-muted-foreground text-[10px]">
                {{ $t('dashboard.widgets.netWorth.vsPrevious') }}
              </span>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-3">
          <div class="rounded-lg border p-3">
            <div class="text-muted-foreground mb-1 text-[11px] font-medium tracking-wider uppercase">
              {{ $t('dashboard.widgets.netWorth.start') }}
            </div>
            <div v-if="startNetWorth === null" class="text-amount text-muted-foreground text-sm">
              {{ NO_VALUE_LABEL }}
            </div>
            <FitAmount v-else :value="startNetWorth" class="text-amount text-sm" />
          </div>

          <div class="rounded-lg border p-3">
            <div class="text-muted-foreground mb-1 text-[11px] font-medium tracking-wider uppercase">
              {{ $t('dashboard.widgets.netWorth.end') }}
            </div>
            <div v-if="endNetWorth === null" class="text-amount text-muted-foreground text-sm">
              {{ NO_VALUE_LABEL }}
            </div>
            <FitAmount v-else :value="endNetWorth" class="text-amount text-sm" />
          </div>

          <div class="rounded-lg border p-3">
            <div class="text-muted-foreground mb-1 text-[11px] font-medium tracking-wider uppercase">
              {{ $t('dashboard.widgets.netWorth.growth') }}
            </div>
            <div
              class="text-amount text-sm"
              :class="{
                'text-app-income-color': growthPercent !== null && growthPercent >= 0,
                'text-app-expense-color': growthPercent !== null && growthPercent < 0,
                'text-muted-foreground': growthPercent === null,
              }"
            >
              {{ formattedGrowth }}
            </div>
          </div>
        </div>

        <div class="mt-auto flex flex-col gap-1.5">
          <div class="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
            {{ $t('dashboard.widgets.netWorth.previousPeriodsTrend') }}
          </div>
          <div class="flex h-25 items-end gap-2.5">
            <ResponsiveTooltip v-for="(bar, index) in trendBars" :key="index" variant="chart" :delay-duration="100">
              <div class="flex flex-1 flex-col items-center gap-1">
                <div class="flex h-22 w-full max-w-10 items-end justify-center">
                  <div
                    class="min-h-1 w-full rounded-xs transition-all duration-500"
                    :class="{
                      'bg-muted': !bar.hasData,
                      'bg-app-income-color/90': bar.hasData && bar.isPositive,
                      'bg-app-expense-color/90': bar.hasData && !bar.isPositive,
                    }"
                    :style="{ height: `${bar.heightPercent}%` }"
                  />
                </div>
                <span class="text-muted-foreground text-[9px] leading-none">{{ bar.shortLabel }}</span>
              </div>
              <template #content>
                <ChartTooltipHeader>{{ bar.label }}</ChartTooltipHeader>

                <div v-if="!bar.hasData" class="text-card-tooltip-muted">
                  {{ $t('dashboard.widgets.netWorth.trendTooltip.noData') }}
                </div>

                <template v-else>
                  <ChartTooltipRow
                    :label="$t('dashboard.widgets.netWorth.trendTooltip.change')"
                    :value="bar.formattedDelta"
                    :value-class="bar.isPositive ? 'text-app-income-color' : 'text-app-expense-color'"
                  />
                  <ChartTooltipRow
                    total
                    :label="$t('dashboard.widgets.netWorth.trendTooltip.netWorth')"
                    :value="bar.formattedNetWorth"
                  />
                </template>
              </template>
            </ResponsiveTooltip>
          </div>
        </div>
      </div>
    </template>
  </WidgetWrapper>
</template>
