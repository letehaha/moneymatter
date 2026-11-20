<script setup lang="ts">
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import { toLocalNumber } from '@/js/helpers/formatters';
import { cn } from '@/lib/utils';
import { computed } from 'vue';

import { exceedsMaxDecimals, trimTrailingZeros } from './utils/precision-number';

const props = withDefaults(
  defineProps<{
    /** Raw numeric value. Accepts strings to preserve backend fixed-scale precision. */
    value: string | number;
    /** Decimal places rendered in the visible (rounded) display. */
    maxDecimals: number;
    /** Additional classes applied to the underlined trigger span when a tooltip is shown. */
    triggerClass?: string;
  }>(),
  {
    triggerClass: undefined,
  },
);

const rawString = computed(() => trimTrailingZeros(String(props.value)));
const displayValue = computed(() =>
  toLocalNumber(props.value, { minimumFractionDigits: 0, maximumFractionDigits: props.maxDecimals }),
);
const shouldReveal = computed(() => exceedsMaxDecimals({ value: rawString.value, maxDecimals: props.maxDecimals }));
</script>

<template>
  <ResponsiveTooltip v-if="shouldReveal" :content="rawString">
    <span :class="cn('cursor-help underline decoration-dotted underline-offset-4', triggerClass)">
      {{ displayValue }}
    </span>
  </ResponsiveTooltip>
  <template v-else>{{ displayValue }}</template>
</template>
