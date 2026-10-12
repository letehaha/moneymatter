<script setup lang="ts">
import { updateBudgetPlan } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import ResponsivePopover from '@/components/common/responsive-popover.vue';
import FormattedAmountField from '@/components/fields/formatted-amount-field.vue';
import { Button } from '@/components/lib/ui/button';
import { useFormatCurrency } from '@/composable';
import { useInvalidatingMutation } from '@/composable/data-queries/use-invalidating-mutation';
import { cn } from '@/lib/utils';
import type { BudgetPlanGoalsSummary, BudgetPlanPeriodViewLine } from '@bt/shared/types';
import { CircleCheckIcon, ChevronRightIcon, MoonIcon, PlusIcon, TargetIcon, TriangleAlertIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';

import { BUDGET_POOL_ENABLED, type PanelContext, amountToneClass } from '../helpers';

const props = defineProps<{
  context: PanelContext;
  goals: BudgetPlanGoalsSummary;
  lines: BudgetPlanPeriodViewLine[];
}>();
const emit = defineEmits<{ selectLine: [lineId: string] }>();

const { formatBaseCurrency } = useFormatCurrency();

const isIncomeOpen = ref(false);
const income = ref<number | null>(null);

watch(isIncomeOpen, (open) => {
  if (open) income.value = props.goals.expectedIncome;
});

const underfunded = computed(() =>
  props.goals.underfunded.map((entry) => ({
    ...entry,
    name: props.lines.find((line) => line.lineId === entry.lineId)?.name ?? '',
  })),
);

const hasSnoozedGoal = computed(() => props.lines.some((line) => line.goal?.status === 'snoozed'));

const { isPending: isSavingIncome, mutate: saveIncome } = useInvalidatingMutation({
  mutationFn: updateBudgetPlan,
  invalidateKeys: [VUE_QUERY_CACHE_KEYS.budgetPlans],
  successKey: 'budgetPlans.goals.expectedIncomeSaved',
  errorKey: 'budgetPlans.goals.expectedIncomeError',
  onSuccess: () => {
    isIncomeOpen.value = false;
  },
});

const submitIncome = ({ value }: { value: number | null }) => {
  if (isSavingIncome.value) return;
  saveIncome({ planId: props.context.planId, payload: { expectedIncome: value } });
};
</script>

<template>
  <div class="grid gap-3 text-sm">
    <div class="flex min-w-0 items-start gap-2">
      <TargetIcon class="text-primary-text mt-0.5 size-4 shrink-0" />
      <div class="min-w-0 flex-1">
        <p class="truncate font-medium">{{ $t('budgetPlans.goals.periodGoals') }}</p>
        <p class="text-muted-foreground truncate text-xs">{{ $t('budgetPlans.goals.periodGoalsHint') }}</p>
      </div>
      <span
        v-if="underfunded.length"
        class="bg-warning/15 text-warning-text flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      >
        <TriangleAlertIcon class="size-3" />
        {{ $t('budgetPlans.goals.toFund', { n: underfunded.length }) }}
      </span>
      <span
        v-else-if="hasSnoozedGoal"
        class="bg-muted text-muted-foreground flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      >
        <MoonIcon class="size-3" />
        {{ $t('budgetPlans.goals.status.snoozed') }}
      </span>
      <span
        v-else
        class="bg-success-text/15 text-success-text flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      >
        <CircleCheckIcon class="size-3" />
        {{ $t('budgetPlans.goals.allFunded') }}
      </span>
    </div>

    <div class="grid grid-cols-2 gap-2">
      <div class="border-border bg-background rounded-md border p-2">
        <p class="text-muted-foreground text-[10px] font-medium uppercase">
          {{ $t('budgetPlans.goals.periodTargets') }}
        </p>
        <p class="font-semibold tabular-nums">{{ formatBaseCurrency(goals.totalTarget) }}</p>
      </div>
      <div class="border-border bg-background rounded-md border p-2">
        <p class="text-muted-foreground text-[10px] font-medium uppercase">
          {{ $t('budgetPlans.goals.stillNeeded') }}
        </p>
        <p :class="cn('font-semibold tabular-nums', goals.stillNeeded > 0 && 'text-warning-text')">
          {{ formatBaseCurrency(goals.stillNeeded) }}
        </p>
      </div>
    </div>

    <ResponsivePopover
      v-if="BUDGET_POOL_ENABLED"
      align="end"
      v-model:open="isIncomeOpen"
      :title="$t('budgetPlans.goals.expectedIncome')"
      content-class="w-72"
    >
      <template #trigger>
        <Button
          v-if="goals.expectedIncome === null"
          variant="outline"
          size="sm"
          class="text-muted-foreground w-full min-w-0 border-dashed"
        >
          <PlusIcon class="size-4" />
          {{ $t('budgetPlans.goals.addExpectedIncome') }}
        </Button>
        <Button
          v-else
          variant="outline"
          class="border-border bg-background grid h-auto w-full min-w-0 grid-cols-2 gap-2 p-2 text-left font-normal"
        >
          <span class="min-w-0">
            <span class="text-muted-foreground block text-[10px] font-medium uppercase">
              {{ $t('budgetPlans.goals.expectedIncome') }}
            </span>
            <span class="block truncate font-semibold tabular-nums">
              {{ formatBaseCurrency(goals.expectedIncome) }}
            </span>
          </span>
          <span class="min-w-0">
            <span class="text-muted-foreground block text-[10px] font-medium uppercase">
              {{ $t('budgetPlans.goals.leftAfterTargets') }}
            </span>
            <span
              :class="
                cn(
                  'block truncate font-semibold tabular-nums',
                  amountToneClass({ amount: goals.expectedIncome - goals.totalTarget }),
                )
              "
            >
              {{ formatBaseCurrency(goals.expectedIncome - goals.totalTarget) }}
            </span>
          </span>
        </Button>
      </template>

      <form class="grid gap-3" @submit.prevent="submitIncome({ value: income })">
        <FormattedAmountField
          :model-value="income"
          :label="$t('budgetPlans.goals.expectedIncome')"
          :placeholder="$t('budgetPlans.goals.expectedIncomePlaceholder')"
          @update:model-value="(value) => (income = value)"
        />
        <div class="flex justify-end gap-2">
          <Button
            v-if="goals.expectedIncome !== null"
            type="button"
            variant="ghost"
            size="sm"
            :disabled="isSavingIncome"
            @click="submitIncome({ value: null })"
          >
            {{ $t('common.actions.clear') }}
          </Button>
          <Button type="submit" size="sm" :disabled="isSavingIncome || income === null || income < 0">
            {{ $t('common.actions.save') }}
          </Button>
        </div>
      </form>
    </ResponsivePopover>

    <div v-if="underfunded.length" class="grid gap-1">
      <div class="text-muted-foreground flex min-w-0 justify-between gap-3 text-xs">
        <span>{{ $t('budgetPlans.goals.stillNeeded') }}</span>
        <span class="tabular-nums">
          {{ $t('budgetPlans.goals.stillNeededTotal', { amount: formatBaseCurrency(goals.stillNeeded) }) }}
        </span>
      </div>
      <Button
        v-for="entry in underfunded"
        :key="entry.lineId"
        variant="ghost"
        class="-mx-2 h-auto min-w-0 justify-start gap-2 px-2 py-1.5 text-left font-normal"
        @click="emit('selectLine', entry.lineId)"
      >
        <TriangleAlertIcon class="text-warning-text size-4 shrink-0" />
        <span class="min-w-0 flex-1">
          <span class="block truncate">{{ entry.name }}</span>
          <span class="text-muted-foreground block text-xs">{{
            $t(`budgetPlans.goals.unit.${context.unit}.needLabel`)
          }}</span>
        </span>
        <span class="bg-warning/15 text-warning-text shrink-0 rounded-full px-2 py-0.5 text-xs tabular-nums">
          {{ formatBaseCurrency(entry.ask) }}
        </span>
        <ChevronRightIcon class="text-muted-foreground size-4 shrink-0" />
      </Button>
    </div>
  </div>
</template>
