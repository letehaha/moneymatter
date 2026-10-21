<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/lib/ui/collapsible';
import { useFormatCurrency } from '@/composable';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import type { GoalModel } from '@bt/shared/types';
import { ChevronDownIcon } from '@lucide/vue';
import { computed, ref } from 'vue';

import { useGoalsFeasibility } from '../composables/use-goals-feasibility';
import { GOAL_DISPLAY_TONES } from '../helpers';

const props = defineProps<{ goals: GoalModel[] }>();

const { formatWholeOrCompactAmount } = useFormatCurrency();
const { feasibility } = useGoalsFeasibility({ goals: () => props.goals });
const isOpen = ref(false);

const ready = computed(() =>
  feasibility.value?.state === 'ready' && !feasibility.value.fits ? feasibility.value : null,
);
const formatAmount = (amount: number) =>
  formatWholeOrCompactAmount({ amount, currencyCode: ready.value!.baseCurrencyCode });
</script>

<template>
  <Callout
    v-if="ready"
    variant="warning"
    :title="$t('goals.feasibility.summary', { needed: formatAmount(ready.needed), saving: formatAmount(ready.saving) })"
    class="tabular-nums"
    role="status"
  >
    <p>{{ $t('goals.feasibility.short', { amount: formatAmount(ready.needed - ready.saving) }) }}</p>

    <Collapsible v-model:open="isOpen">
      <CollapsibleTrigger as-child>
        <Button variant="link" size="sm" class="mt-1 h-auto p-0">
          {{ isOpen ? $t('goals.feasibility.hideGoals') : $t('goals.feasibility.showGoals') }}
          <ChevronDownIcon :class="cn('size-4 transition-transform duration-200', isOpen && 'rotate-180')" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul class="mt-2 space-y-1.5">
          <li v-for="item in ready.items" :key="item.goal.id" class="flex items-center gap-3">
            <RouterLink
              :to="{ name: ROUTES_NAMES.goalDetails, params: { goalId: item.goal.id } }"
              class="text-foreground min-w-0 flex-1 truncate hover:underline"
            >
              {{ item.goal.name }}
            </RouterLink>
            <span class="shrink-0">{{ $t('goals.feasibility.perMonth', { amount: formatAmount(item.monthly) }) }}</span>
            <span
              :class="
                cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                  GOAL_DISPLAY_TONES[item.fits ? 'on_track' : 'behind'].pillClass,
                )
              "
            >
              {{ item.fits ? $t('goals.feasibility.goalFits') : $t('goals.feasibility.goalDoesNotFit') }}
            </span>
          </li>
          <li v-for="item in ready.due" :key="item.goal.id" class="flex items-center gap-3">
            <RouterLink
              :to="{ name: ROUTES_NAMES.goalDetails, params: { goalId: item.goal.id } }"
              class="text-foreground min-w-0 flex-1 truncate hover:underline"
            >
              {{ item.goal.name }}
            </RouterLink>
            <span
              :class="
                cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                  GOAL_DISPLAY_TONES[item.daysLeft < 0 ? 'overdue' : 'behind'].pillClass,
                )
              "
            >
              {{
                item.daysLeft < 0
                  ? $t('goals.status.overdue')
                  : $t('goals.feasibility.dueIn', { count: item.daysLeft }, item.daysLeft)
              }}
            </span>
          </li>
        </ul>
        <p v-if="ready.due.length" class="text-muted-foreground mt-2 text-xs">{{ $t('goals.feasibility.dueNote') }}</p>
        <p class="text-muted-foreground mt-2 text-xs">{{ $t('goals.feasibility.footnote') }}</p>
      </CollapsibleContent>
    </Collapsible>
  </Callout>
</template>
