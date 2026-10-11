<script setup lang="ts">
import ResponsivePopover from '@/components/common/responsive-popover.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable';
import { cn } from '@/lib/utils';
import type { BudgetPlanPeriodViewLine, BudgetPlanPeriodViewLineGoal } from '@bt/shared/types';
import { MoonIcon, PencilIcon, TargetIcon } from '@lucide/vue';
import { computed, ref } from 'vue';

import { useGoalActions } from '../composables/use-goal-actions';
import { useGoalText } from '../composables/use-goal-text';
import { type GoalPeriodUnit, goalPeekStats, goalStatusDisplay, goalSubtitle, goalTitle } from '../helpers';

const props = defineProps<{
  planId: string;
  periodId: string;
  unit: GoalPeriodUnit;
  line: BudgetPlanPeriodViewLine & { goal: BudgetPlanPeriodViewLineGoal };
}>();
const emit = defineEmits<{ edit: [] }>();

const { formatBaseCurrency } = useFormatCurrency();
const { goalText } = useGoalText();

const isOpen = ref(false);

const goal = computed(() => props.line.goal);
const display = computed(() => goalStatusDisplay({ goal: goal.value }));
const stats = computed(() => goalPeekStats({ goal: goal.value, line: props.line, unit: props.unit }));
const isSnoozed = computed(() => goal.value.status === 'snoozed');

const { isSnoozing, isBudgeting, toggleSnooze, budgetGoal } = useGoalActions({
  planId: () => props.planId,
  periodId: () => props.periodId,
  line: () => props.line,
});

const openEditor = () => {
  isOpen.value = false;
  emit('edit');
};
</script>

<template>
  <DesktopOnlyTooltip :content="$t('budgetPlans.goals.details')">
    <span class="inline-flex">
      <ResponsivePopover v-model:open="isOpen" :title="line.name" content-class="w-72" align="start">
        <template #trigger>
          <Button
            variant="ghost"
            size="icon-sm"
            :class="cn('size-6 shrink-0', display.textClass)"
            :aria-label="$t('budgetPlans.goals.details')"
          >
            <TargetIcon class="size-3.5" />
          </Button>
        </template>

        <div class="grid gap-3 text-sm">
          <div class="min-w-0">
            <p class="font-semibold wrap-break-word">{{ goalText({ part: goalTitle({ goal }) }) }}</p>
            <p class="text-muted-foreground text-xs">{{ goalText({ part: goalSubtitle({ goal, unit }) }) }}</p>
          </div>

          <div class="bg-muted h-1.5 overflow-hidden rounded-full">
            <div :class="cn('h-full rounded-full', display.barClass)" :style="{ width: `${display.percent}%` }" />
          </div>

          <dl class="border-border grid gap-1.5 rounded-lg border p-3 text-xs">
            <div v-for="stat in stats" :key="stat.labelKey" class="flex min-w-0 justify-between gap-3">
              <dt class="text-muted-foreground truncate">{{ $t(stat.labelKey) }}</dt>
              <dd class="shrink-0 font-medium tabular-nums">{{ formatBaseCurrency(stat.amount) }}</dd>
            </div>
          </dl>

          <div class="flex min-w-0 justify-between gap-3 text-xs">
            <span :class="cn('font-medium', display.textClass)">
              {{ $t(`budgetPlans.goals.status.${display.kind}`) }}
            </span>
            <span class="text-muted-foreground truncate tabular-nums">
              {{
                $t('budgetPlans.goals.percentOf', { percent: display.percent, target: formatBaseCurrency(goal.target) })
              }}
            </span>
          </div>

          <div class="grid gap-2">
            <Button
              v-if="goal.budgetAmount > 0 && !isSnoozed"
              size="sm"
              class="w-full min-w-0"
              :disabled="isBudgeting"
              @click="budgetGoal"
            >
              {{ $t('budgetPlans.goals.assignAsk', { amount: formatBaseCurrency(goal.budgetAmount) }) }}
            </Button>
            <Button
              v-if="goal.frequency !== 'open_ended'"
              variant="outline"
              size="sm"
              class="w-full min-w-0"
              :aria-pressed="isSnoozed"
              :disabled="isSnoozing"
              @click="toggleSnooze"
            >
              <MoonIcon class="size-4" />
              {{ isSnoozed ? $t('budgetPlans.goals.unsnooze') : $t(`budgetPlans.goals.unit.${unit}.snooze`) }}
            </Button>
            <Button variant="ghost" size="sm" class="w-full min-w-0" @click="openEditor">
              <PencilIcon class="size-4" />
              {{ $t('budgetPlans.goals.edit') }}
            </Button>
          </div>
        </div>
      </ResponsivePopover>
    </span>
  </DesktopOnlyTooltip>
</template>
