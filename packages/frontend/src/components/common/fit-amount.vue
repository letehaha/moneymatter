<script setup lang="ts">
import { useFormatCurrency } from '@/composable/formatters';
import { maskAmountText } from '@/js/helpers/formatters';
import { useResizeObserver } from '@vueuse/core';
import { computed, ref, useTemplateRef, watch } from 'vue';

const props = defineProps<{
  value: number;
  /** Final value of an in-flight count-up animation, so the format stays fixed for its whole run. */
  target?: number;
  signed?: boolean;
}>();

const { formatBaseCurrency, formatCompactBaseCurrency } = useFormatCurrency();

const withSign = ({ amount, text }: { amount: number; text: string }) =>
  props.signed && amount > 0 ? maskAmountText({ text: `+${text}` }) : text;
const formatFull = (amount: number) => withSign({ amount, text: formatBaseCurrency(amount) });
const formatCompact = (amount: number) => withSign({ amount, text: formatCompactBaseCurrency({ amount }) });

const settled = computed(() => props.target ?? props.value);
// The start of the current animation; every frame's string is at most as wide as one of the two endpoints.
const from = ref(settled.value);
watch(settled, () => {
  from.value = props.value;
});
watch(
  () => props.value === settled.value,
  (isSettled) => {
    if (isSettled) from.value = settled.value;
  },
);

const boxRef = useTemplateRef<HTMLElement>('box');
const fromProbeRef = useTemplateRef<HTMLElement>('fromProbe');
const targetProbeRef = useTemplateRef<HTMLElement>('targetProbe');
const widths = new Map<Element, number>();
const fits = ref(true);

// Only the box and the static probes are observed, so animation frames never trigger a measurement.
useResizeObserver([boxRef, fromProbeRef, targetProbeRef], (entries) => {
  for (const entry of entries) widths.set(entry.target, entry.borderBoxSize[0]!.inlineSize);
  const box = widths.get(boxRef.value!) ?? 0;
  const needed = Math.max(widths.get(fromProbeRef.value!) ?? 0, widths.get(targetProbeRef.value!) ?? 0);
  fits.value = needed <= box + 0.5;
});
</script>

<template>
  <span ref="box" class="relative block min-w-0 overflow-hidden whitespace-nowrap">
    <span ref="fromProbe" aria-hidden="true" class="invisible absolute w-max">{{ formatFull(from) }}</span>
    <span ref="targetProbe" aria-hidden="true" class="invisible absolute w-max">{{ formatFull(settled) }}</span>
    {{ fits ? formatFull(value) : formatCompact(value) }}
  </span>
</template>
