<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { useFormatCurrency } from '@/composable';
import { trimAmountNoise } from '@/js/helpers/currency-decimals';
import { maskAmountText } from '@/js/helpers/formatters';
import type { BudgetPlanPeriodViewLine } from '@bt/shared/types';
import { computed } from 'vue';

import { useSetAssignment } from '../composables/use-set-assignment';
import { type LineAverages, type PanelContext, buildAssignmentPayload } from '../helpers';

const props = defineProps<{ context: PanelContext; line: BudgetPlanPeriodViewLine; averages: LineAverages }>();

const { formatBaseCurrency, baseCurrencyDecimals } = useFormatCurrency();
const { isPending, mutate } = useSetAssignment();

const options = computed(() =>
  (['lastAssigned', 'lastSpent', 'avgAssigned', 'avgSpent'] as const).map((key) => {
    const amount = props.averages[key];
    const change = trimAmountNoise({ value: amount - props.line.assigned, decimals: baseCurrencyDecimals.value });
    const payload =
      change === 0
        ? null
        : buildAssignmentPayload({
            line: props.line,
            amount,
            scope: 'this_period',
            carryPolicy: props.line.carryPolicy,
          });
    return {
      key,
      amount,
      change,
      variables: payload && {
        planId: props.context.planId,
        periodId: props.context.period.id,
        lineId: props.line.lineId,
        payload,
      },
    };
  }),
);

const changeText = ({ change }: { change: number }) =>
  change > 0 ? maskAmountText({ text: `+${formatBaseCurrency(change)}` }) : formatBaseCurrency(change);
</script>

<template>
  <div class="@container/averages grid gap-2 text-sm">
    <div class="flex min-w-0 items-baseline justify-between gap-3">
      <span class="font-medium">{{ $t('budgetPlans.panel.averages.setAssigned') }}</span>
      <span class="text-muted-foreground shrink-0 text-xs tabular-nums">
        {{ $t('budgetPlans.panel.averages.now', { amount: formatBaseCurrency(line.assigned) }) }}
      </span>
    </div>

    <div class="grid grid-cols-1 gap-2 @3xs/averages:grid-cols-2">
      <Button
        v-for="option in options"
        :key="option.key"
        variant="outline"
        class="h-auto min-w-0 flex-col items-start gap-0.5 p-2 text-left font-normal"
        :disabled="isPending || !option.variables"
        @click="option.variables && mutate(option.variables)"
      >
        <span class="text-muted-foreground w-full truncate text-xs">
          {{ $t(`budgetPlans.panel.averages.${option.key}`) }}
        </span>
        <span class="w-full truncate font-semibold tabular-nums">{{ formatBaseCurrency(option.amount) }}</span>
        <span class="text-muted-foreground w-full truncate text-xs tabular-nums">
          {{ option.change === 0 ? $t('budgetPlans.panel.averages.noChange') : changeText({ change: option.change }) }}
        </span>
      </Button>
    </div>

    <p class="text-muted-foreground text-xs">
      {{ $t('budgetPlans.panel.averages.hint', averages.periodCount) }}
    </p>
  </div>
</template>
