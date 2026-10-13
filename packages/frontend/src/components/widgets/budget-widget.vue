<script lang="ts" setup>
import { loadBudgetPlanPeriodView, loadBudgetPlanPeriods, loadBudgetPlans } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { buttonVariants } from '@/components/lib/ui/button';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable/formatters';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import BudgetLineBars from '@/pages/budget/components/budget-line-bars.vue';
import BudgetLineSpentText from '@/pages/budget/components/budget-line-spent-text.vue';
import { useGridDisplayOptions } from '@/pages/budget/composables/use-grid-display-options';
import {
  amountToneClass,
  availablePillClass,
  formatPeriodShortLabel,
  goalStatusDisplay,
  groupLines,
  periodProgress,
  periodSpend,
  sumLineTotals,
} from '@/pages/budget/helpers';
import { ROUTES_NAMES } from '@/routes/constants';
import { useRootStore } from '@/stores';
import type { BudgetPlanPeriodViewLine } from '@bt/shared/types';
import { ArrowUpRightIcon, WalletIcon } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { createReusableTemplate, useElementVisibility, useScroll } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { computed, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import ErrorState from './components/error-state.vue';
import WidgetWrapper from './components/widget-wrapper.vue';

const { t } = useI18n();
const { isAppInitialized } = storeToRefs(useRootStore());
const { formatBaseCurrency, formatShortBaseCurrency } = useFormatCurrency();
const { locale } = useDateLocale();
const { rowBars } = useGridDisplayOptions();

const [DefineRing, Ring] = createReusableTemplate<{ strokeWidth: number }>();
const [DefineLine, Line] = createReusableTemplate<{ line: BudgetPlanPeriodViewLine }>();

const plansQuery = useQuery({
  queryKey: VUE_QUERY_CACHE_KEYS.budgetPlansList,
  queryFn: loadBudgetPlans,
  enabled: isAppInitialized,
});

const planId = computed(() => plansQuery.data.value?.find((plan) => !plan.deletedAt)?.id);

const periodsQuery = useQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.budgetPlanPeriods, planId.value]),
  queryFn: () => loadBudgetPlanPeriods({ planId: planId.value! }),
  enabled: computed(() => Boolean(planId.value)),
});

const periodId = computed(() => {
  const list = periodsQuery.data.value ?? [];
  return list.find((period) => period.isCurrent)?.id ?? list[0]?.id;
});

const viewQuery = useQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.budgetPlanPeriodView, planId.value, periodId.value]),
  queryFn: () => loadBudgetPlanPeriodView({ planId: planId.value!, periodId: periodId.value! }),
  enabled: computed(() => Boolean(planId.value && periodId.value)),
});

const view = computed(() => viewQuery.data.value);
const queries = [plansQuery, periodsQuery, viewQuery];

const isFetching = computed(() => queries.some((query) => query.isFetching.value));
const hasNoPlan = computed(() => plansQuery.isSuccess.value && !planId.value);
const hasNoPeriod = computed(() => periodsQuery.isSuccess.value && !periodId.value);
const isError = computed(() => !view.value && (hasNoPeriod.value || queries.some((query) => query.isError.value)));
// The plan list is refetched every time: a plan deleted elsewhere fails the other two while the list still looks fine.
const retry = () => {
  for (const query of queries) if (query === plansQuery || query.isError.value) void query.refetch();
};

const RING_RADIUS = 15;
const HEADLINE_RING_STROKE = 3;
const HEADER_RING_STROKE = 6;
const SKELETON_ROWS = 3;

const spend = computed(() => (view.value ? periodSpend({ header: view.value.header }) : { funded: 0, percent: 0 }));
const spentPercent = computed(() => spend.value.percent);
const funded = computed(() => spend.value.funded);
const available = computed(() => view.value?.header.totalAvailable ?? 0);
const isOver = computed(() => available.value < 0);

const headerHeadline = computed(() =>
  t(isOver.value ? 'dashboard.widgets.budget.headerOver' : 'dashboard.widgets.budget.headerLeft', {
    amount: formatBaseCurrency(Math.abs(available.value)),
  }),
);

const periodLabel = computed(() =>
  view.value ? formatPeriodShortLabel({ ...view.value.period, locale: locale.value }) : '',
);
const daysLeft = computed(() => (view.value ? periodProgress(view.value.period).daysLeft : 0));

const sections = computed(() => {
  const { ungrouped, groups } = groupLines({
    lines: view.value?.lines ?? [],
    groups: view.value?.groups ?? [],
  });
  return {
    ungrouped,
    groups: groups.map((section) => ({ ...section, totals: sumLineTotals({ lines: section.lines }) })),
  };
});

const goalDisplays = computed(
  () =>
    new Map(
      (view.value?.lines ?? []).flatMap((line) =>
        line.goal ? [[line.lineId, goalStatusDisplay({ goal: line.goal })] as const] : [],
      ),
    ),
);

const scrollAreaRef = useTemplateRef<InstanceType<typeof ScrollArea>>('scrollAreaRef');
const scrollRef = computed<HTMLElement | null>(() => scrollAreaRef.value?.viewportRef?.viewportElement ?? null);
const headlineRef = useTemplateRef<HTMLElement>('headlineRef');
const { arrivedState, measure } = useScroll(scrollRef);
// useScroll measures on mount and on scroll only, and the scroll area mounts after the data arrives.
watch([scrollRef, view], () => measure(), { flush: 'post' });
const isHeadlineVisible = useElementVisibility(headlineRef, {
  scrollTarget: scrollRef,
  initialValue: true,
});
const showHeaderHeadline = computed(() => !!headlineRef.value && !isHeadlineVisible.value);
</script>

<template>
  <DefineRing v-slot="{ strokeWidth }">
    <svg viewBox="0 0 36 36" class="size-full -rotate-90" aria-hidden="true">
      <circle cx="18" cy="18" :r="RING_RADIUS" fill="none" class="stroke-foreground/10" :stroke-width="strokeWidth" />
      <circle
        v-if="spentPercent > 0"
        cx="18"
        cy="18"
        :r="RING_RADIUS"
        fill="none"
        path-length="100"
        stroke-linecap="round"
        :class="
          cn('transition-[stroke-dasharray] duration-500', isOver ? 'stroke-app-expense-color' : 'stroke-success-text')
        "
        :stroke-width="strokeWidth"
        :stroke-dasharray="`${spentPercent} 100`"
      />
    </svg>
  </DefineRing>

  <DefineLine v-slot="{ line }">
    <div class="py-2">
      <span class="flex min-w-0 items-center justify-between gap-3">
        <span class="min-w-0 truncate text-sm font-semibold">{{ line.name }}</span>
        <span
          :class="
            cn(
              'shrink-0',
              availablePillClass({
                amount: line.available,
                underfunded: goalDisplays.get(line.lineId)?.kind === 'underfunded',
              }),
            )
          "
        >
          {{ formatShortBaseCurrency({ amount: line.available }) }}
        </span>
      </span>
      <BudgetLineBars :line="line" :goal="goalDisplays.get(line.lineId)" :mode="rowBars" />
      <BudgetLineSpentText :line="line" class="mt-1 block truncate text-xs leading-4" />
    </div>
  </DefineLine>

  <WidgetWrapper class="max-md:max-h-96" :is-fetching="isFetching" data-testid="widget-budget">
    <template #title>{{ $t('dashboard.widgets.registry.budget.name') }}</template>
    <template #action>
      <span
        v-if="view"
        :aria-hidden="!showHeaderHeadline"
        :class="
          cn(
            'mr-1 flex items-center gap-1.5 text-sm font-semibold tabular-nums transition-opacity',
            showHeaderHeadline ? 'opacity-100' : 'pointer-events-none opacity-0',
          )
        "
      >
        <span class="size-4 shrink-0"><Ring :stroke-width="HEADER_RING_STROKE" /></span>
        {{ headerHeadline }}
      </span>

      <DesktopOnlyTooltip :content="$t('common.actions.viewAll')">
        <span class="inline-flex">
          <router-link
            :class="buttonVariants({ variant: 'ghost', size: 'icon-sm', class: 'text-muted-foreground' })"
            :to="{ name: ROUTES_NAMES.budget }"
            :aria-label="$t('common.actions.viewAll')"
          >
            <ArrowUpRightIcon class="size-4" />
          </router-link>
        </span>
      </DesktopOnlyTooltip>
    </template>

    <ErrorState v-if="isError" :message="$t('errors.api.unexpectedError')" @retry="retry" />

    <div v-else-if="hasNoPlan" class="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
      <WalletIcon class="text-muted-foreground size-10" />
      <p class="text-muted-foreground text-sm">{{ $t('dashboard.widgets.budget.empty') }}</p>
      <router-link :class="buttonVariants({ variant: 'outline', size: 'sm' })" :to="{ name: ROUTES_NAMES.budget }">
        {{ $t('dashboard.widgets.budget.create') }}
      </router-link>
    </div>

    <div v-else-if="!view" class="animate-pulse" aria-hidden="true">
      <div class="flex items-center gap-5 pb-3">
        <div class="border-muted size-28 shrink-0 rounded-full border-[9px]" />
        <div class="grid gap-2">
          <div class="bg-muted h-8 w-28 rounded" />
          <div class="bg-muted h-4 w-24 rounded" />
          <div class="bg-muted h-3 w-20 rounded" />
        </div>
      </div>
      <div v-for="row in SKELETON_ROWS" :key="row" class="grid gap-2 py-2">
        <div class="flex items-center justify-between gap-3">
          <div class="bg-muted h-4 w-24 rounded" />
          <div class="bg-muted h-5 w-14 rounded-full" />
        </div>
        <div class="bg-muted h-1.5 rounded-full" />
        <div class="bg-muted h-3 w-32 rounded" />
      </div>
    </div>

    <ScrollArea
      v-else
      ref="scrollAreaRef"
      :class="
        cn(
          '-mx-2 min-h-0 flex-1',
          !arrivedState.bottom && '[mask-image:linear-gradient(to_bottom,black_calc(100%-1.75rem),transparent)]',
        )
      "
      viewport-class="px-2 md:overscroll-contain-if-scrollable"
    >
      <div ref="headlineRef" class="flex items-center gap-5 pb-3">
        <div
          class="relative size-28 shrink-0"
          role="img"
          :aria-label="$t('dashboard.widgets.budget.ringLabel', { percent: Math.round(spentPercent) })"
        >
          <Ring :stroke-width="HEADLINE_RING_STROKE" />
          <div class="absolute inset-0 flex flex-col items-center justify-center">
            <span class="text-2xl leading-tight font-bold tabular-nums">{{ Math.round(spentPercent) }}%</span>
            <span class="text-muted-foreground text-xs">{{ $t('dashboard.widgets.budget.spent') }}</span>
          </div>
        </div>
        <div class="min-w-0">
          <p
            :class="
              cn('text-3xl leading-tight font-bold tracking-tight tabular-nums', isOver && 'text-app-expense-color')
            "
          >
            {{ formatBaseCurrency(Math.abs(available)) }}
          </p>
          <p class="text-muted-foreground text-sm tabular-nums">
            {{
              $t(isOver ? 'dashboard.widgets.budget.overOf' : 'dashboard.widgets.budget.leftOf', {
                total: formatBaseCurrency(funded),
              })
            }}
          </p>
          <p class="text-muted-foreground mt-0.5 text-xs">
            {{ periodLabel }} ·
            {{
              daysLeft > 0
                ? $t('dashboard.widgets.budget.daysLeft', { count: daysLeft }, daysLeft)
                : $t('dashboard.widgets.budget.lastDay')
            }}
          </p>
        </div>
      </div>

      <div class="divide-border/60 divide-y">
        <Line v-for="line in sections.ungrouped" :key="line.lineId" :line="line" />
      </div>

      <template v-for="section in sections.groups" :key="section.group.id">
        <div
          class="bg-card border-border/60 sticky top-0 z-1 flex items-center justify-between gap-3 border-b py-1.5 text-xs font-semibold"
        >
          <span class="text-muted-foreground min-w-0 truncate tracking-wide uppercase">{{ section.group.name }}</span>
          <span :class="cn('shrink-0 tabular-nums', amountToneClass({ amount: section.totals.available }))">
            {{ formatShortBaseCurrency({ amount: section.totals.available }) }}
          </span>
        </div>
        <div class="divide-border/60 divide-y">
          <Line v-for="line in section.lines" :key="line.lineId" :line="line" />
        </div>
      </template>
    </ScrollArea>
  </WidgetWrapper>
</template>
