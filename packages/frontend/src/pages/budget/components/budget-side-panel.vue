<script setup lang="ts">
import { loadBudgetLineTransactions, loadBudgetPlanScheduled, loadBudgetPlanTrends } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import {
  SidePanelSection,
  SidePanelSectionContent,
  SidePanelSectionTrigger,
  SidePanelSections,
} from '@/components/lib/ui/side-panel';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import type { BudgetPlanCadence, BudgetPlanPeriodView, BudgetPlanPeriodViewLine } from '@bt/shared/types';
import {
  ArrowUpDownIcon,
  CalculatorIcon,
  CalendarCheckIcon,
  CalendarClockIcon,
  ChartColumnIcon,
  GaugeIcon,
  ReceiptTextIcon,
  SigmaIcon,
  TargetIcon,
  XIcon,
} from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { type Component, computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  type GoalPeriodUnit,
  type PanelContext,
  type ScheduledCoverage,
  aggregatePace,
  amountToneClass,
  formatPeriodLabel,
  isPastPeriod,
  lineAverages,
  scheduledCoverage,
  scheduledForLines,
  sumLineTotals,
  TREND_PERIOD_COUNT,
  TRENDS_FETCH_COUNT,
} from '../helpers';
import PanelAveragesSection from './panel-averages-section.vue';
import PanelBreakdownSection from './panel-breakdown-section.vue';
import PanelCoverageSection from './panel-coverage-section.vue';
import PanelGoalSection from './panel-goal-section.vue';
import PanelGoalsSection from './panel-goals-section.vue';
import PanelPaceSection from './panel-pace-section.vue';
import PanelScheduledSection from './panel-scheduled-section.vue';
import PanelTransactionsSection from './panel-transactions-section.vue';
import {
  PANEL_SECTION_TITLES,
  type PanelSection,
  usePanelSectionLayout,
  usePanelSections,
} from '../composables/use-panel-sections';
import ArrangePanelDialog from './arrange-panel-dialog.vue';
import PanelTrendSection from './panel-trend-section.vue';

type SectionEntry = {
  key: PanelSection;
  icon: Component;
  component: Component;
  iconClass?: string;
  props?: Record<string, unknown>;
  hidden?: boolean;
  summary?: string;
};

const props = defineProps<{
  planId: string;
  accountIds: string[];
  cadence: BudgetPlanCadence;
  unit: GoalPeriodUnit;
  view: BudgetPlanPeriodView;
  /** Empty → period overview, one → line details, several → aggregated selection. */
  lines: BudgetPlanPeriodViewLine[];
  /** Mobile drawer: closes by swipe, so no close button, and keeps its own open sections. */
  drawer?: boolean;
}>();
const emit = defineEmits<{ close: []; selectLine: [lineId: string] }>();

const { t } = useI18n();
const { formatBaseCurrency, baseCurrencyDecimals } = useFormatCurrency();
const { locale } = useDateLocale();
const openSections = usePanelSections({ drawer: props.drawer });
const layout = usePanelSectionLayout();
const isArrangeOpen = ref(false);

const line = computed(() => (props.lines.length === 1 ? props.lines[0] : undefined));
const lineIds = computed(() => props.lines.map((entry) => entry.lineId));
const figures = computed(() => {
  if (line.value) return line.value;
  if (props.lines.length) return sumLineTotals({ lines: props.lines, decimals: baseCurrencyDecimals.value });
  const { totalCarriedIn, totalAssigned, totalActivity, totalAvailable } = props.view.header;
  return { carriedIn: totalCarriedIn, assigned: totalAssigned, activity: totalActivity, available: totalAvailable };
});

const periodLabel = computed(() => formatPeriodLabel({ ...props.view.period, locale: locale.value }));
const periodId = computed(() => props.view.period.id);
const isPast = computed(() => isPastPeriod({ period: props.view.period }));

const trendsQuery = useQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.budgetPlanTrends, props.planId, periodId.value]),
  queryFn: () => loadBudgetPlanTrends({ planId: props.planId, until: periodId.value, count: TRENDS_FETCH_COUNT }),
});

const scheduledQuery = useQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.budgetPlanScheduled, props.planId, periodId.value]),
  queryFn: () => loadBudgetPlanScheduled({ planId: props.planId, periodId: periodId.value }),
  enabled: computed(() => !isPast.value),
});

const lineTransactionsQuery = useQuery({
  queryKey: computed(() => [
    ...VUE_QUERY_CACHE_KEYS.budgetPlanLineTransactions,
    props.planId,
    periodId.value,
    line.value?.lineId,
  ]),
  queryFn: () =>
    loadBudgetLineTransactions({ planId: props.planId, periodId: periodId.value, lineId: line.value!.lineId }),
  enabled: computed(
    () => Boolean(line.value) && openSections.value.transactions && !layout.value.hidden.includes('transactions'),
  ),
});

const { data: allTrends } = trendsQuery;
const trends = computed(() =>
  allTrends.value ? { periods: allTrends.value.periods.slice(-TREND_PERIOD_COUNT) } : undefined,
);
const averages = computed(() =>
  line.value && allTrends.value
    ? lineAverages({
        periods: allTrends.value.periods,
        lineId: line.value.lineId,
        decimals: baseCurrencyDecimals.value,
      })
    : null,
);
const { data: scheduledData } = scheduledQuery;

const failedQueries = computed(() =>
  [trendsQuery, scheduledQuery, lineTransactionsQuery].filter((query) => query.isError.value),
);
const isRetrying = computed(() => failedQueries.value.some((query) => query.isFetching.value));
const retryFailed = () => failedQueries.value.forEach((query) => query.refetch());

const scheduled = computed(() =>
  scheduledData.value ? scheduledForLines({ scheduled: scheduledData.value, lineIds: lineIds.value }) : undefined,
);

const coverageByLine = computed(() => {
  const items = scheduledData.value?.items;
  if (!items) return new Map<string, ScheduledCoverage>();
  return new Map(
    props.view.lines.map((entry) => [
      entry.lineId,
      scheduledCoverage({
        items: items.filter((item) => item.lineId === entry.lineId),
        available: entry.available,
        decimals: baseCurrencyDecimals.value,
      }),
    ]),
  );
});
const lineCoverage = computed(() => (line.value ? coverageByLine.value.get(line.value.lineId) : undefined));
const shortLines = computed(() =>
  props.lines.length
    ? []
    : props.view.lines.flatMap((entry) => {
        const coverage = coverageByLine.value.get(entry.lineId);
        const bill = coverage?.bills.find((candidate) => candidate.status === 'short');
        return coverage && bill
          ? [{ lineId: entry.lineId, name: entry.name, short: coverage.short, bill: bill.item }]
          : [];
      }),
);

const context = computed<PanelContext>(() => ({
  planId: props.planId,
  cadence: props.cadence,
  unit: props.unit,
  period: props.view.period,
  lineIds: lineIds.value,
  figures: figures.value,
  trends: trends.value,
  scheduled: scheduled.value,
  pace: aggregatePace({ lines: props.lines.length ? props.lines : props.view.lines }),
}));

const sections = computed(() => {
  const hasTrends = Boolean(trends.value?.periods.length);
  const all: SectionEntry[] = [
    {
      key: 'breakdown',
      icon: CalculatorIcon,
      iconClass: 'bg-app-savings-color/15 text-app-savings-color',
      component: PanelBreakdownSection,
    },
    {
      key: 'transactions',
      icon: ReceiptTextIcon,
      component: PanelTransactionsSection,
      props: {
        line: line.value,
        accountIds: props.accountIds,
        data: lineTransactionsQuery.data.value,
        isLoading: lineTransactionsQuery.isPending.value,
      },
      hidden: !line.value || lineTransactionsQuery.isError.value,
    },
    {
      key: 'coverage',
      icon: CalendarCheckIcon,
      iconClass: 'bg-automation-when/15 text-automation-when',
      component: PanelCoverageSection,
      props: { coverage: props.view.coverage },
      hidden: props.lines.length > 0 || !props.view.coverage,
    },
    {
      key: 'scheduled',
      icon: CalendarClockIcon,
      iconClass: 'bg-account-cash/15 text-account-cash',
      component: PanelScheduledSection,
      props: {
        detail: line.value && lineCoverage.value ? { line: line.value, coverage: lineCoverage.value } : undefined,
        shortLines: shortLines.value,
      },
      summary: shortLines.value.length ? t('budgetPlans.panel.notCovered.count', shortLines.value.length) : undefined,
      hidden: isPast.value || !scheduled.value || (props.lines.length > 0 && !scheduled.value.items.length),
    },
    {
      key: 'trend',
      icon: ChartColumnIcon,
      component: PanelTrendSection,
      hidden: !hasTrends,
    },
    {
      key: 'averages',
      icon: SigmaIcon,
      component: PanelAveragesSection,
      props: { line: line.value, averages: averages.value },
      hidden: !line.value || !averages.value,
    },
    {
      key: 'pace',
      icon: GaugeIcon,
      iconClass: 'bg-warning-text/15 text-warning-text',
      component: PanelPaceSection,
      hidden: !props.view.period.isCurrent,
    },
    {
      key: 'goals',
      icon: TargetIcon,
      iconClass: 'bg-success-text/15 text-success-text',
      component: PanelGoalsSection,
      props: { goals: props.view.goals, lines: props.view.lines },
      hidden: props.lines.length > 0 || !props.view.goals,
    },
    {
      key: 'goal',
      icon: TargetIcon,
      iconClass: 'bg-success-text/15 text-success-text',
      component: PanelGoalSection,
      props: { line: line.value },
      hidden: !line.value,
    },
  ];
  const { order, hidden } = layout.value;
  return all
    .filter((section) => !section.hidden && !hidden.includes(section.key))
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
});
</script>

<template>
  <div class="grid grid-cols-1 gap-4">
    <div
      :class="
        cn(
          'flex min-w-0 items-start justify-between gap-2',
          drawer && 'bg-dialog sticky top-0 z-10 -mx-4 px-4 pt-3 pb-2',
        )
      "
    >
      <div class="min-w-0">
        <h2 class="truncate font-semibold">
          <template v-if="line">{{ line.name }}</template>
          <template v-else-if="lines.length">{{ $t('budgetPlans.grid.selectedCount', lines.length) }}</template>
          <template v-else>{{ $t('budgetPlans.panel.overview') }}</template>
        </h2>
        <p class="text-muted-foreground text-xs">{{ periodLabel }}</p>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <slot name="actions" />
        <DesktopOnlyTooltip :content="$t('budgetPlans.panel.arrange.title')">
          <Button
            variant="outline"
            size="icon-sm"
            :aria-label="$t('budgetPlans.panel.arrange.title')"
            @click="isArrangeOpen = true"
          >
            <ArrowUpDownIcon class="size-4" />
          </Button>
        </DesktopOnlyTooltip>
        <DesktopOnlyTooltip v-if="lines.length && !drawer" :content="$t('budgetPlans.panel.closeLine')">
          <Button variant="ghost" size="icon-sm" :aria-label="$t('budgetPlans.panel.closeLine')" @click="emit('close')">
            <XIcon class="size-4" />
          </Button>
        </DesktopOnlyTooltip>
      </div>
    </div>

    <slot name="summary" />

    <div
      v-if="lines.length"
      :class="
        cn(
          'flex min-w-0 flex-wrap items-center justify-between gap-x-3 rounded-xl border px-4 py-3',
          lineCoverage?.short ? 'border-warning/40 bg-warning/10' : 'border-border bg-muted/40',
        )
      "
    >
      <p class="text-muted-foreground text-xs font-medium tracking-wider uppercase">
        {{ $t('budgetPlans.grid.available') }}
      </p>
      <p :class="cn('text-2xl font-bold tabular-nums', amountToneClass({ amount: figures.available }))">
        {{ formatBaseCurrency(figures.available) }}
      </p>
      <p v-if="lineCoverage?.short" class="text-warning-text w-full text-sm font-medium tabular-nums">
        {{ $t('budgetPlans.panel.notCovered.shortForScheduled', { amount: formatBaseCurrency(lineCoverage.short) }) }}
      </p>
    </div>

    <div
      v-if="line?.goal && line.goal.budgetAmount > 0 && line.goal.status !== 'snoozed'"
      class="border-warning/40 bg-warning/10 grid gap-0.5 rounded-lg border p-3 text-sm"
    >
      <p class="text-warning-text font-medium tabular-nums">
        {{ $t(`budgetPlans.goals.unit.${unit}.need`, { amount: formatBaseCurrency(line.goal.budgetAmount) }) }}
      </p>
      <p class="text-muted-foreground text-xs">{{ $t('budgetPlans.goals.askHint') }}</p>
    </div>

    <SidePanelSections variant="cards">
      <SidePanelSection v-for="section in sections" :key="section.key" v-model:open="openSections[section.key]">
        <SidePanelSectionTrigger :icon="section.icon" :icon-class="section.iconClass">
          {{ $t(PANEL_SECTION_TITLES[section.key]) }}
          <template v-if="section.summary" #summary>{{ section.summary }}</template>
        </SidePanelSectionTrigger>
        <SidePanelSectionContent>
          <component
            :is="section.component"
            :context="context"
            v-bind="section.props"
            @select-line="(lineId: string) => emit('selectLine', lineId)"
          />
        </SidePanelSectionContent>
      </SidePanelSection>
    </SidePanelSections>

    <Callout v-if="failedQueries.length" variant="destructive">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span>{{ $t('budgetPlans.loadError') }}</span>
        <Button size="sm" variant="outline" :disabled="isRetrying" @click="retryFailed">
          {{ $t('common.actions.retry') }}
        </Button>
      </div>
    </Callout>

    <ArrangePanelDialog v-model:open="isArrangeOpen" />
  </div>
</template>
