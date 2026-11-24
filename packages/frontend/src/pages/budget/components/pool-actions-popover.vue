<script setup lang="ts">
import { loadBudgetPlanTrends } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import DocsLink from '@/components/common/docs-link.vue';
import ResponsivePopover from '@/components/common/responsive-popover.vue';
import { Button } from '@/components/lib/ui/button';
import { Separator } from '@/components/lib/ui/separator';
import { useFormatCurrency } from '@/composable';
import { CUSTOM_BREAKPOINTS, useWindowBreakpoints } from '@/composable/window-breakpoints';
import type { BudgetPlanPeriodView } from '@bt/shared/types';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  HandCoinsIcon,
  InfoIcon,
  PencilIcon,
  RepeatIcon,
  TargetIcon,
} from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { type Component, computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { useSetAssignments } from '../composables/use-set-assignments';
import {
  type PoolDirection,
  type PoolItem,
  type PoolSuggestion,
  goalFundingItems,
  leftoverTakeBackItems,
  overspendingItems,
  poolCost,
  repeatLastMonthItems,
  sumPoolItems,
  takeBackCandidates,
  toAssignmentsPayload,
  undoAssignmentsPayload,
} from '../helpers';
import PoolLineStep from './pool-line-step.vue';
import PoolReviewStep from './pool-review-step.vue';

// Stays mounted while hidden: unmounting it in the render that closes its drawer can leave the page inert.
const props = withDefaults(
  defineProps<{
    planId: string;
    view: BudgetPlanPeriodView;
    mode: 'assign' | 'fix';
    visible?: boolean;
    prominent?: boolean;
  }>(),
  { visible: true, prominent: false },
);

const PREVIOUS_PERIOD_TRENDS_COUNT = 2;

const { t } = useI18n();
const { baseCurrencyDecimals: decimals, formatBaseCurrency } = useFormatCurrency();
const isMobile = useWindowBreakpoints(CUSTOM_BREAKPOINTS.uiMobile);

// Steps keep the view they opened with, so a refetch can't shift the amounts under an open form.
type Step =
  | { name: 'menu' }
  | { name: 'review'; suggestion: PoolSuggestion; view: BudgetPlanPeriodView }
  | { name: 'line'; view: BudgetPlanPeriodView };

const isOpen = ref(false);
const step = ref<Step>({ name: 'menu' });

watch(isOpen, (open) => {
  if (open) step.value = { name: 'menu' };
});

const isFix = computed(() => props.mode === 'fix');
const direction = computed<PoolDirection>(() => (isFix.value ? 'takeBack' : 'assign'));
const readyToAssign = computed(() => props.view.pool?.readyToAssign ?? 0);
const shortfall = computed(() => Math.max(-readyToAssign.value, 0));

const trendsQuery = useQuery({
  queryKey: computed(() => [
    ...VUE_QUERY_CACHE_KEYS.budgetPlanTrends,
    props.planId,
    props.view.period.id,
    PREVIOUS_PERIOD_TRENDS_COUNT,
  ]),
  queryFn: () =>
    loadBudgetPlanTrends({ planId: props.planId, until: props.view.period.id, count: PREVIOUS_PERIOD_TRENDS_COUNT }),
  enabled: computed(() => isOpen.value && !isFix.value),
});

const previousLines = computed(() => {
  const periods = trendsQuery.data.value?.periods ?? [];
  return periods.length === PREVIOUS_PERIOD_TRENDS_COUNT && periods[1]!.periodId === props.view.period.id
    ? periods[0]!.lines
    : [];
});

const suggestionItems = computed<Record<PoolSuggestion, PoolItem[]>>(() =>
  isFix.value
    ? {
        goals: [],
        overspending: [],
        repeat: [],
        leftovers: leftoverTakeBackItems({ view: props.view, shortfall: shortfall.value, decimals: decimals.value }),
      }
    : {
        goals: goalFundingItems({ view: props.view }),
        overspending: overspendingItems({ view: props.view }),
        repeat: repeatLastMonthItems({ view: props.view, previous: previousLines.value, decimals: decimals.value }),
        leftovers: [],
      },
);

const lineName = ({ lineId }: { lineId: string }) =>
  props.view.lines.find((line) => line.lineId === lineId)?.name ?? '';

const SUGGESTION_TITLES = {
  goals: 'budgetPlans.pool.menu.goalsTitle',
  overspending: 'budgetPlans.pool.menu.overspendingTitle',
  repeat: 'budgetPlans.pool.menu.repeatTitle',
  leftovers: 'budgetPlans.pool.freeUp.leftoversTitle',
} as const;

const SUGGESTION_ICONS: Record<PoolSuggestion, Component> = {
  goals: TargetIcon,
  overspending: CircleAlertIcon,
  repeat: RepeatIcon,
  leftovers: HandCoinsIcon,
};

const suggestionDescription = ({ suggestion, items }: { suggestion: PoolSuggestion; items: PoolItem[] }) => {
  const count = items.length;
  switch (suggestion) {
    case 'goals':
      return t('budgetPlans.pool.menu.goalsDescription', count);
    case 'overspending':
      return count === 1
        ? t('budgetPlans.pool.menu.overspendingOne', {
            line: lineName(items[0]!),
            amount: formatBaseCurrency(items[0]!.amount),
          })
        : t('budgetPlans.pool.menu.overspendingMany', count);
    case 'repeat':
      return t('budgetPlans.pool.menu.repeatDescription', count);
    case 'leftovers':
      return count === 1
        ? t('budgetPlans.pool.freeUp.leftoversOne', { line: lineName(items[0]!) })
        : t('budgetPlans.pool.freeUp.leftoversTwo', { first: lineName(items[0]!), second: lineName(items[1]!) });
  }
};

const suggestionRows = computed(() =>
  (Object.keys(SUGGESTION_TITLES) as PoolSuggestion[])
    .filter((suggestion) => suggestionItems.value[suggestion].length)
    .map((suggestion) => {
      const items = suggestionItems.value[suggestion];
      return {
        suggestion,
        icon: SUGGESTION_ICONS[suggestion],
        title: t(SUGGESTION_TITLES[suggestion]),
        description: suggestionDescription({ suggestion, items }),
        total: sumPoolItems({ items, decimals: decimals.value }),
      };
    }),
);

const hasTakeBackLines = computed(() => takeBackCandidates({ lines: props.view.lines }).length > 0);
const showNoSuggestions = computed(() => !isFix.value && !suggestionRows.value.length && trendsQuery.isSuccess.value);

const title = computed(() => {
  if (step.value.name === 'review') return t(SUGGESTION_TITLES[step.value.suggestion]);
  if (step.value.name === 'line')
    return t(isFix.value ? 'budgetPlans.pool.freeUp.oneLineTitle' : 'budgetPlans.pool.menu.oneLineTitle');
  return isFix.value
    ? t('budgetPlans.pool.freeUp.title', { amount: formatBaseCurrency(shortfall.value) })
    : t('budgetPlans.pool.menu.assignTitle', { amount: formatBaseCurrency(readyToAssign.value) });
});

const TOAST_KEYS = {
  assign: {
    one: 'budgetPlans.pool.toast.assignedOne',
    two: 'budgetPlans.pool.toast.assignedTwo',
    many: 'budgetPlans.pool.toast.assignedMany',
  },
  takeBack: {
    one: 'budgetPlans.pool.toast.tookBackOne',
    two: 'budgetPlans.pool.toast.tookBackTwo',
    many: 'budgetPlans.pool.toast.tookBackMany',
  },
} as const;

const toastText = ({ view, items }: { view: BudgetPlanPeriodView; items: PoolItem[] }) => {
  const keys = TOAST_KEYS[direction.value];
  const costs =
    direction.value === 'assign'
      ? items.map((item) => ({
          lineId: item.lineId,
          amount: poolCost({
            line: view.lines.find((line) => line.lineId === item.lineId)!,
            amount: item.amount,
            decimals: decimals.value,
          }),
        }))
      : items;
  const amount = formatBaseCurrency(sumPoolItems({ items: costs, decimals: decimals.value }));
  if (items.length === 1) return t(keys.one, { amount, line: lineName(items[0]!) });
  if (items.length === 2) return t(keys.two, { amount, first: lineName(items[0]!), second: lineName(items[1]!) });
  return t(keys.many, { amount, count: items.length }, items.length);
};

const { isPending, mutate } = useSetAssignments({
  onSuccess: () => {
    isOpen.value = false;
  },
});

const save = ({ items }: { items: PoolItem[] }) => {
  if (step.value.name === 'menu') return;
  const { view } = step.value;
  const payload = toAssignmentsPayload({
    view,
    items,
    direction: direction.value,
    decimals: decimals.value,
  });
  if (isPending.value || !payload.assignments.length) return;
  const saved = items.filter((item) => payload.assignments.some((entry) => entry.lineId === item.lineId));
  mutate({
    planId: props.planId,
    periodId: view.period.id,
    payload,
    text: toastText({ view, items: saved }),
    undoPayload: undoAssignmentsPayload({
      view,
      lineIds: payload.assignments.map((entry) => entry.lineId),
    }),
  });
};
</script>

<template>
  <ResponsivePopover align="end" v-model:open="isOpen" :title="title" content-class="w-96">
    <template #trigger>
      <Button
        v-show="visible"
        :variant="isFix ? 'outline' : 'default'"
        :size="prominent ? 'default' : 'sm'"
        :disabled="!isFix && readyToAssign <= 0"
      >
        <template v-if="isFix">{{ $t('budgetPlans.pool.fix') }}</template>
        <template v-else-if="prominent">
          {{ $t('budgetPlans.pool.assignAmount', { amount: formatBaseCurrency(readyToAssign) }) }}
        </template>
        <template v-else>{{ $t('budgetPlans.pool.assign') }}</template>
        <ChevronDownIcon class="size-4" />
      </Button>
    </template>

    <div class="grid grid-cols-1 gap-3">
      <h3 v-if="!isMobile" class="text-base font-medium">{{ title }}</h3>

      <template v-if="step.name === 'menu'">
        <p v-if="isFix && !hasTakeBackLines" class="text-muted-foreground text-sm">
          {{ $t('budgetPlans.pool.fixNoLines') }}
        </p>

        <template v-else>
          <p class="text-muted-foreground text-sm">
            {{ isFix ? $t('budgetPlans.pool.freeUp.subtitle') : $t('budgetPlans.pool.menu.assignSubtitle') }}
          </p>

          <div class="grid grid-cols-1 gap-1">
            <Button
              v-for="row in suggestionRows"
              :key="row.suggestion"
              variant="ghost"
              class="h-auto w-full justify-start gap-3 p-2 text-left whitespace-normal"
              @click="step = { name: 'review', suggestion: row.suggestion, view }"
            >
              <span class="bg-muted flex size-8 shrink-0 items-center justify-center rounded-full">
                <component :is="row.icon" class="text-muted-foreground size-4" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-medium">{{ row.title }}</span>
                <span class="text-muted-foreground block truncate text-xs">{{ row.description }}</span>
              </span>
              <span class="shrink-0 text-sm tabular-nums">{{ formatBaseCurrency(row.total) }}</span>
              <ChevronRightIcon class="text-muted-foreground size-4 shrink-0" />
            </Button>

            <p v-if="showNoSuggestions" class="text-muted-foreground flex gap-2 px-2 py-1 text-sm">
              <InfoIcon class="mt-0.5 size-4 shrink-0" />
              {{ $t('budgetPlans.pool.menu.noSuggestions') }}
            </p>

            <Separator class="my-1" />

            <Button
              variant="ghost"
              class="h-auto w-full justify-start gap-3 p-2 text-left whitespace-normal"
              @click="step = { name: 'line', view }"
            >
              <span class="bg-muted flex size-8 shrink-0 items-center justify-center rounded-full">
                <PencilIcon class="text-muted-foreground size-4" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-medium">
                  {{ isFix ? $t('budgetPlans.pool.freeUp.oneLineTitle') : $t('budgetPlans.pool.menu.oneLineTitle') }}
                </span>
                <span class="text-muted-foreground block truncate text-xs">
                  {{
                    isFix
                      ? $t('budgetPlans.pool.freeUp.oneLineDescription')
                      : $t('budgetPlans.pool.menu.oneLineDescription')
                  }}
                </span>
              </span>
              <ChevronRightIcon class="text-muted-foreground size-4 shrink-0" />
            </Button>
          </div>

          <p v-if="isFix" class="text-muted-foreground text-sm">{{ $t('budgetPlans.pool.freeUp.laterIncome') }}</p>
        </template>

        <DocsLink v-if="isFix" path="/budgeting/ready-to-assign/#over-assigned" class="text-xs" />
      </template>

      <PoolReviewStep
        v-else-if="step.name === 'review'"
        :view="step.view"
        :suggestion="step.suggestion"
        :direction="direction"
        :items="suggestionItems[step.suggestion]"
        :pending="isPending"
        @back="step = { name: 'menu' }"
        @submit="(items) => save({ items })"
      />

      <PoolLineStep
        v-else
        :view="step.view"
        :direction="direction"
        :pending="isPending"
        @back="step = { name: 'menu' }"
        @submit="(items) => save({ items })"
      />
    </div>
  </ResponsivePopover>
</template>
