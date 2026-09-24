<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/lib/ui/collapsible';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import type { BudgetPlanPeriodViewLine } from '@bt/shared/types';
import { ChevronDownIcon, MoonIcon, PencilIcon, PlusIcon, TargetIcon, Trash2Icon } from '@lucide/vue';
import { parseISO } from 'date-fns';
import { computed, ref } from 'vue';

import { useGoalActions } from '../composables/use-goal-actions';
import { useGoalText } from '../composables/use-goal-text';
import { type PanelContext, goalStatusDisplay, goalSubtitle, goalTitle } from '../helpers';
import DeleteGoalDialog from './delete-goal-dialog.vue';
import GoalEditorDialog from './goal-editor-dialog.vue';

const props = defineProps<{ context: PanelContext; line: BudgetPlanPeriodViewLine }>();

const { formatBaseCurrency } = useFormatCurrency();
const { format } = useDateLocale();
const { goalText } = useGoalText();

const isEditorOpen = ref(false);
const isDeleteOpen = ref(false);

const goal = computed(() => props.line.goal);
const display = computed(() => (goal.value ? goalStatusDisplay({ goal: goal.value }) : null));
const toGo = computed(() => (goal.value ? Math.max(0, goal.value.target - goal.value.progress) : 0));
const isSnoozed = computed(() => goal.value?.status === 'snoozed');
const snoozeLabel = computed(() =>
  isSnoozed.value ? 'budgetPlans.goals.unsnooze' : `budgetPlans.goals.unit.${props.context.unit}.snooze`,
);

const periodPattern = computed(() => (props.context.unit === 'month' ? 'MMM yyyy' : 'd MMM yyyy'));

const { isSnoozing, isBudgeting, toggleSnooze, budgetGoal } = useGoalActions({
  planId: () => props.context.planId,
  periodId: () => props.context.period.id,
  line: () => props.line,
});
</script>

<template>
  <div>
    <div v-if="!goal || !display" class="grid justify-items-start gap-2 text-sm">
      <p class="text-muted-foreground">{{ $t('budgetPlans.goals.noGoal') }}</p>
      <Button variant="outline" size="sm" @click="isEditorOpen = true">
        <PlusIcon class="size-4" />
        {{ $t('budgetPlans.goals.create') }}
      </Button>
    </div>

    <div v-else class="grid gap-3 text-sm">
      <div class="flex min-w-0 items-start gap-2">
        <TargetIcon :class="cn('mt-0.5 size-4 shrink-0', display.textClass)" />
        <div class="min-w-0 flex-1">
          <p class="font-medium wrap-break-word">{{ goalText({ part: goalTitle({ goal }) }) }}</p>
          <p class="text-muted-foreground text-xs">
            {{ goalText({ part: goalSubtitle({ goal, unit: context.unit }) }) }}
          </p>
        </div>
        <div class="flex shrink-0">
          <DesktopOnlyTooltip v-if="goal.frequency !== 'open_ended'" :content="$t(snoozeLabel)">
            <Button
              variant="ghost"
              size="icon-sm"
              :aria-label="$t(snoozeLabel)"
              :aria-pressed="isSnoozed"
              :class="cn(isSnoozed && 'text-primary-text hover:text-primary-text')"
              :disabled="isSnoozing"
              @click="toggleSnooze"
            >
              <MoonIcon class="size-4" />
            </Button>
          </DesktopOnlyTooltip>
          <DesktopOnlyTooltip :content="$t('budgetPlans.goals.edit')">
            <Button
              variant="ghost"
              size="icon-sm"
              :aria-label="$t('budgetPlans.goals.edit')"
              @click="isEditorOpen = true"
            >
              <PencilIcon class="size-4" />
            </Button>
          </DesktopOnlyTooltip>
          <DesktopOnlyTooltip :content="$t('budgetPlans.goals.delete')">
            <Button
              variant="ghost-destructive"
              size="icon-sm"
              :aria-label="$t('budgetPlans.goals.delete')"
              @click="isDeleteOpen = true"
            >
              <Trash2Icon class="size-4" />
            </Button>
          </DesktopOnlyTooltip>
        </div>
      </div>

      <div class="bg-muted h-1.5 overflow-hidden rounded-full">
        <div :class="cn('h-full rounded-full', display.barClass)" :style="{ width: `${display.percent}%` }" />
      </div>

      <div class="grid gap-0.5">
        <div class="flex min-w-0 justify-between gap-3 text-xs">
          <span class="truncate tabular-nums">
            {{
              $t('budgetPlans.goals.progressOf', {
                progress: formatBaseCurrency(goal.progress),
                target: formatBaseCurrency(goal.target),
                percent: display.percent,
              })
            }}
          </span>
          <span :class="cn('shrink-0 font-medium', display.textClass)">
            {{ $t(`budgetPlans.goals.status.${display.kind}`) }}
          </span>
        </div>
        <p v-if="toGo > 0" class="text-muted-foreground text-xs tabular-nums">
          {{ $t('budgetPlans.goals.toGo', { amount: formatBaseCurrency(toGo) }) }}
        </p>
      </div>

      <Button
        v-if="goal.budgetAmount > 0 && !isSnoozed"
        size="sm"
        class="w-full min-w-0"
        :disabled="isBudgeting"
        @click="budgetGoal"
      >
        {{ $t('budgetPlans.goals.assignAsk', { amount: formatBaseCurrency(goal.budgetAmount) }) }}
      </Button>

      <Collapsible v-if="goal.fundingPlan && !isSnoozed" v-slot="{ open }">
        <CollapsibleTrigger as-child>
          <Button variant="ghost" size="sm" class="-mx-2 w-[calc(100%+1rem)] justify-between px-2 font-medium">
            {{ $t('budgetPlans.goals.fundingPlan') }}
            <ChevronDownIcon :class="cn('text-muted-foreground size-4 transition-transform', open && 'rotate-180')" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div class="grid gap-1.5 pt-1 text-xs">
            <div
              v-for="(row, index) in goal.fundingPlan"
              :key="row.periodStart"
              class="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] items-center gap-2"
            >
              <span class="truncate">{{ format(parseISO(row.periodStart), periodPattern) }}</span>
              <span class="text-muted-foreground truncate tabular-nums">
                {{
                  index === 0
                    ? $t(`budgetPlans.goals.unit.${context.unit}.current`)
                    : $t('budgetPlans.goals.leftAfter', { amount: formatBaseCurrency(row.leftAfter) })
                }}
              </span>
              <span class="font-medium tabular-nums">{{ formatBaseCurrency(row.amount) }}</span>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>

    <GoalEditorDialog
      v-model:open="isEditorOpen"
      :plan-id="context.planId"
      :period-id="context.period.id"
      :unit="context.unit"
      :line="line"
    />

    <DeleteGoalDialog v-model:open="isDeleteOpen" :plan-id="context.planId" :line="line" />
  </div>
</template>
