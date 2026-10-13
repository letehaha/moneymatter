<script setup lang="ts">
import { loadBudgetPlanScheduled, loadBudgetPlanTrends } from '@/api/budget-plans';
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
  CalculatorIcon,
  CalendarCheckIcon,
  CalendarClockIcon,
  ChartColumnIcon,
  GaugeIcon,
  TargetIcon,
  XIcon,
} from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { type Component, computed } from 'vue';

import {
  type GoalPeriodUnit,
  type PanelContext,
  amountToneClass,
  formatPeriodLabel,
  isPastPeriod,
  scheduledForLines,
  sumLineTotals,
  TREND_PERIOD_COUNT,
} from '../helpers';
import PanelBreakdownSection from './panel-breakdown-section.vue';
import PanelCoverageSection from './panel-coverage-section.vue';
import PanelGoalSection from './panel-goal-section.vue';
import PanelGoalsSection from './panel-goals-section.vue';
import PanelPaceSection from './panel-pace-section.vue';
import PanelScheduledSection from './panel-scheduled-section.vue';
import { type PanelSection, usePanelSections } from '../composables/use-panel-sections';
import PanelTrendSection from './panel-trend-section.vue';

type SectionEntry = {
  key: PanelSection;
  titleKey: string;
  icon: Component;
  component: Component;
  iconClass?: string;
  props?: Record<string, unknown>;
  hidden?: boolean;
};

const props = defineProps<{
  planId: string;
  cadence: BudgetPlanCadence;
  unit: GoalPeriodUnit;
  view: BudgetPlanPeriodView;
  /** Empty → period overview, one → line details, several → aggregated selection. */
  lines: BudgetPlanPeriodViewLine[];
  /** Mobile drawer: closes by swipe, so no close button, and keeps its own open sections. */
  drawer?: boolean;
}>();
const emit = defineEmits<{ close: []; selectLine: [lineId: string] }>();

const { formatBaseCurrency } = useFormatCurrency();
const { locale } = useDateLocale();
const openSections = usePanelSections({ drawer: props.drawer });

const line = computed(() => (props.lines.length === 1 ? props.lines[0] : undefined));
const lineIds = computed(() => props.lines.map((entry) => entry.lineId));
const figures = computed(() => {
  if (line.value) return line.value;
  if (props.lines.length) return sumLineTotals({ lines: props.lines });
  const { totalCarriedIn, totalAssigned, totalActivity, totalAvailable } = props.view.header;
  return { carriedIn: totalCarriedIn, assigned: totalAssigned, activity: totalActivity, available: totalAvailable };
});

const periodLabel = computed(() => formatPeriodLabel({ ...props.view.period, locale: locale.value }));
const periodId = computed(() => props.view.period.id);
const isPast = computed(() => isPastPeriod({ period: props.view.period }));

const trendsQuery = useQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.budgetPlanTrends, props.planId, periodId.value]),
  queryFn: () => loadBudgetPlanTrends({ planId: props.planId, until: periodId.value, count: TREND_PERIOD_COUNT }),
});

const scheduledQuery = useQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.budgetPlanScheduled, props.planId, periodId.value]),
  queryFn: () => loadBudgetPlanScheduled({ planId: props.planId, periodId: periodId.value }),
  enabled: computed(() => !isPast.value),
});

const { data: trends } = trendsQuery;
const { data: scheduledData } = scheduledQuery;

const failedQueries = computed(() => [trendsQuery, scheduledQuery].filter((query) => query.isError.value));
const isRetrying = computed(() => failedQueries.value.some((query) => query.isFetching.value));
const retryFailed = () => failedQueries.value.forEach((query) => query.refetch());

const scheduled = computed(() =>
  scheduledData.value ? scheduledForLines({ scheduled: scheduledData.value, lineIds: lineIds.value }) : undefined,
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
}));

const sections = computed(() => {
  const hasTrends = Boolean(trends.value?.periods.length);
  const all: SectionEntry[] = [
    {
      key: 'breakdown',
      titleKey: 'budgetPlans.panel.breakdown',
      icon: CalculatorIcon,
      iconClass: 'bg-app-savings-color/15 text-app-savings-color',
      component: PanelBreakdownSection,
    },
    {
      key: 'coverage',
      icon: CalendarCheckIcon,
      iconClass: 'bg-automation-when/15 text-automation-when',
      titleKey: 'budgetPlans.panel.nextPeriodCoverage',
      component: PanelCoverageSection,
      props: { coverage: props.view.coverage },
      hidden: props.lines.length > 0 || !props.view.coverage,
    },
    {
      key: 'scheduled',
      icon: CalendarClockIcon,
      iconClass: 'bg-account-cash/15 text-account-cash',
      titleKey: 'budgetPlans.panel.scheduled',
      component: PanelScheduledSection,
      hidden: isPast.value || !scheduled.value || (props.lines.length > 0 && !scheduled.value.items.length),
    },
    {
      key: 'trend',
      icon: ChartColumnIcon,
      titleKey: 'budgetPlans.panel.trend.title',
      component: PanelTrendSection,
      hidden: !hasTrends,
    },
    {
      key: 'pace',
      icon: GaugeIcon,
      iconClass: 'bg-warning-text/15 text-warning-text',
      titleKey: 'budgetPlans.panel.pace',
      component: PanelPaceSection,
      hidden: !props.view.period.isCurrent,
    },
    {
      key: 'goals',
      icon: TargetIcon,
      iconClass: 'bg-success-text/15 text-success-text',
      titleKey: 'budgetPlans.panel.goals',
      component: PanelGoalsSection,
      props: { goals: props.view.goals, lines: props.view.lines },
      hidden: props.lines.length > 0 || !props.view.goals,
    },
    {
      key: 'goal',
      icon: TargetIcon,
      iconClass: 'bg-success-text/15 text-success-text',
      titleKey: 'budgetPlans.panel.goal',
      component: PanelGoalSection,
      props: { line: line.value },
      hidden: !line.value,
    },
  ];
  return all.filter((section) => !section.hidden);
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
      class="border-border bg-muted/40 flex min-w-0 flex-wrap items-center justify-between gap-x-3 rounded-xl border px-4 py-3"
    >
      <p class="text-muted-foreground text-xs font-medium tracking-wider uppercase">
        {{ $t('budgetPlans.grid.available') }}
      </p>
      <p :class="cn('text-2xl font-bold tabular-nums', amountToneClass({ amount: figures.available }))">
        {{ formatBaseCurrency(figures.available) }}
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
        <SidePanelSectionTrigger :icon="section.icon" :icon-class="section.iconClass">{{
          $t(section.titleKey)
        }}</SidePanelSectionTrigger>
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
  </div>
</template>
