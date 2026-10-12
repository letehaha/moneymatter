<script setup lang="ts">
import { cn } from '@/lib/utils';
import { computed } from 'vue';

import type { RowBarMode } from '../composables/use-grid-display-options';
import { type LineAmounts, type goalStatusDisplay, lineBarsOf } from '../helpers';

const props = defineProps<{
  line: LineAmounts;
  goal?: ReturnType<typeof goalStatusDisplay>;
  mode: RowBarMode;
}>();

const bars = computed(() => lineBarsOf({ line: props.line }));
const showGoal = computed(
  () => props.mode !== 'spending' && props.mode !== 'none' && props.goal && props.goal.kind !== 'snoozed',
);
const showSpending = computed(() => props.mode === 'spending' || props.mode === 'combined');
const showSplit = computed(() => props.mode === 'split');
const SPLIT_TRACK_CLASS = 'bg-foreground/10 relative block overflow-hidden rounded-full';
const splitFillClass = ({ healthyClass }: { healthyClass: string }) =>
  cn('absolute inset-y-0 left-0 rounded-full', bars.value.isOverspent ? 'bg-app-expense-color' : healthyClass);
</script>

<template>
  <span v-if="showGoal || showSpending || showSplit" class="mt-0.5 grid gap-0.5">
    <span v-if="showGoal && goal" class="bg-foreground/10 block h-1 overflow-hidden rounded-full">
      <span :class="cn('block h-full rounded-full', goal.barClass)" :style="{ width: `${goal.percent}%` }" />
    </span>

    <span
      v-if="showSpending || (showSplit && bars.carried <= 0)"
      :class="cn('flex h-1.5 gap-0.5 overflow-hidden rounded-full', !bars.isOverspent && 'bg-foreground/10')"
    >
      <template v-if="bars.isOverspent">
        <span
          v-if="bars.overspentFundedPercent > 0"
          class="bg-app-expense-color/40"
          :style="{ width: `${bars.overspentFundedPercent}%` }"
        />
        <span class="bg-app-expense-color min-w-2 flex-1" />
      </template>
      <template v-else>
        <span
          v-if="bars.deficitPercent > 0"
          class="bg-foreground/40 min-w-1 last:rounded-r-full"
          :style="{ width: `${bars.deficitPercent}%` }"
        />
        <span
          v-if="bars.spendPercent > 0"
          class="bg-success-text min-w-1 rounded-r-full"
          :style="{ width: `${bars.spendPercent}%` }"
        />
      </template>
    </span>

    <span v-else-if="showSplit" class="flex h-1.5 gap-0.5">
      <span :class="SPLIT_TRACK_CLASS" :style="{ flex: `${bars.carried} 1 0` }">
        <span
          :class="splitFillClass({ healthyClass: 'bg-success-text/50' })"
          :style="{ width: `${bars.carriedSpentPercent}%` }"
        />
      </span>
      <span v-if="bars.assigned > 0" :class="SPLIT_TRACK_CLASS" :style="{ flex: `${bars.assigned} 1 0` }">
        <span
          :class="splitFillClass({ healthyClass: 'bg-success-text' })"
          :style="{ width: `${bars.assignedSpentPercent}%` }"
        />
      </span>
    </span>
  </span>
</template>
