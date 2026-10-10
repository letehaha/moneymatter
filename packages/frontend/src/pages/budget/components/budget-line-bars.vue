<script setup lang="ts">
import { cn } from '@/lib/utils';
import type { BudgetPlanPeriodViewLine } from '@bt/shared/types';
import { computed } from 'vue';

import type { RowBarMode } from '../composables/use-grid-display-options';
import { type goalStatusDisplay, lineBarsOf } from '../helpers';

const props = defineProps<{
  line: BudgetPlanPeriodViewLine;
  goal?: ReturnType<typeof goalStatusDisplay>;
  mode: RowBarMode;
}>();

const bars = computed(() => lineBarsOf({ line: props.line }));
const isFunded = computed(() => bars.value.carried + bars.value.assigned > 0);
const showGoal = computed(
  () => props.mode !== 'spending' && props.mode !== 'none' && props.goal && props.goal.kind !== 'snoozed',
);
const showSpending = computed(() => props.mode === 'spending' || props.mode === 'combined');
const showSplit = computed(() => props.mode === 'split');
const spentClass = computed(() =>
  cn('spent-stripes absolute inset-y-0 left-0', bars.value.isOverspent && 'bg-app-expense-color'),
);
</script>

<template>
  <span v-if="showGoal || showSpending || showSplit" class="mt-0.5 grid gap-0.5">
    <span v-if="showGoal && goal" class="bg-foreground/10 block h-1 overflow-hidden rounded-full">
      <span :class="cn('block h-full rounded-full', goal.barClass)" :style="{ width: `${goal.percent}%` }" />
    </span>

    <span
      v-if="showSpending || (showSplit && !isFunded)"
      :class="cn('relative block h-1 overflow-hidden rounded-full', isFunded ? 'bg-success-text' : 'bg-foreground/10')"
    >
      <span :class="spentClass" :style="{ width: `${bars.spentPercent}%` }" />
    </span>

    <span v-else-if="showSplit" class="flex h-1 gap-0.5">
      <span
        v-if="bars.carried > 0"
        class="bg-success-text/50 relative block overflow-hidden rounded-full"
        :style="{ flex: `${bars.carried} 1 0` }"
      >
        <span :class="spentClass" :style="{ width: `${bars.carriedSpentPercent}%` }" />
      </span>
      <span
        v-if="bars.assigned > 0"
        class="bg-success-text relative block overflow-hidden rounded-full"
        :style="{ flex: `${bars.assigned} 1 0` }"
      >
        <span :class="spentClass" :style="{ width: `${bars.assignedSpentPercent}%` }" />
      </span>
    </span>
  </span>
</template>

<style scoped>
.spent-stripes {
  background-image: repeating-linear-gradient(
    -45deg,
    color-mix(in oklab, var(--background) 55%, transparent) 0 2px,
    transparent 2px 4px
  );
}
</style>
