<script setup lang="ts">
import { useFormatCurrency } from '@/composable';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { type LineWithPace, linePaceOf, paceCaptionNumbers } from '../helpers';

const props = defineProps<{ line: LineWithPace; daysLeft: number }>();

const { t } = useI18n();
const { formatShortBaseCurrency } = useFormatCurrency();

const text = computed(() => {
  const { state, pace, spent, funded } = linePaceOf({ line: props.line });
  if (state !== 'ahead' || !pace) return null;
  const { aheadBy, perDay } = paceCaptionNumbers({
    spent,
    funded,
    available: props.line.available,
    expectedPercent: pace.expectedPercent,
    daysLeft: props.daysLeft,
  });
  const isUsual = pace.basisLabel === 'usual';
  const amount = formatShortBaseCurrency({ amount: aheadBy });
  if (perDay === null) return t(isUsual ? 'budgetPlans.pace.aheadUsual' : 'budgetPlans.pace.aheadEven', { amount });
  return t(
    isUsual ? 'budgetPlans.pace.aheadUsualPerDay' : 'budgetPlans.pace.aheadEvenPerDay',
    { amount, perDay: formatShortBaseCurrency({ amount: perDay }), count: props.daysLeft },
    props.daysLeft,
  );
});
</script>

<template>
  <span v-if="text" class="text-warning-text mt-1 block truncate text-xs leading-4 tabular-nums">{{ text }}</span>
</template>
