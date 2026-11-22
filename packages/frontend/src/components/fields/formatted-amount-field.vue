<template>
  <FieldLabel :label="label">
    <template v-if="$slots['label-right']" #label-right>
      <slot name="label-right" />
    </template>
    <div class="relative">
      <input
        ref="inputRef"
        type="text"
        inputmode="decimal"
        :value="displayValue"
        :placeholder="placeholder"
        :disabled="disabled"
        autocomplete="off"
        spellcheck="false"
        :class="
          cn(
            'border-input bg-input-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-md border px-3 py-2 text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50',
            controlHeight[size],
            errorMessage && 'border-destructive',
          )
        "
        @input="onInput"
        @blur="emit('blur')"
      />
    </div>
    <FieldError :error-message="errorMessage" />
  </FieldLabel>
</template>

<script setup lang="ts">
import FieldError from '@/components/fields/components/field-error.vue';
import FieldLabel from '@/components/fields/components/field-label.vue';
import {
  caretOffsetAfterDigits,
  countDigitsBeforeCaret,
  getAmountSeparators,
  parseAmountInput,
} from '@/components/fields/utils/formatted-amount';
import { type ControlSize, controlHeight } from '@/components/lib/ui/control-size';
import { cn } from '@/lib/utils';
import { computed, nextTick, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue: number | null;
    label?: string;
    placeholder?: string;
    disabled?: boolean;
    errorMessage?: string;
    /** Decimals of the amount's currency; typed precision beyond it is dropped. */
    decimals: number;
    size?: ControlSize;
  }>(),
  {
    label: undefined,
    placeholder: undefined,
    errorMessage: undefined,
    size: 'default',
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: number | null];
  blur: [];
}>();

const inputRef = ref<HTMLInputElement | null>(null);

// Tail the numeric model can't represent (trailing '.' or zeros, e.g. "1234.50") —
// keeps the input showing exactly what the user typed mid-edit.
const trailingFragment = ref<string>('');

const separators = getAmountSeparators();

const MAX_INTL_FRACTION_DIGITS = 20;

const countFractionDigits = ({ value }: { value: number }): number => {
  // 15 significant digits drop float noise, so a computed 50.04999999999999 counts as 50.05.
  const [mantissa = '', exponent = '0'] = String(Number(value.toPrecision(15))).split('e');
  return Math.max(0, (mantissa.split('.')[1]?.length ?? 0) - Number(exponent));
};

// Locale grouping/decimal separators, matching the rest of the app's number rendering.
// A model with more digits than the currency allows shows them all, so the form's error matches the field.
const formatter = computed(
  () =>
    new Intl.NumberFormat(undefined, {
      maximumFractionDigits: Math.min(
        MAX_INTL_FRACTION_DIGITS,
        Math.max(props.decimals, props.modelValue == null ? 0 : countFractionDigits({ value: props.modelValue })),
      ),
      minimumFractionDigits: 0,
    }),
);

const formatNumber = (value: number): string => {
  if (Number.isNaN(value)) return '';
  return formatter.value.format(value);
};

const displayValue = computed(() => {
  // fragment uses a canonical '.' — swap in the locale's decimal separator to match the formatter.
  const fragment = trailingFragment.value.replace('.', separators.decimal);
  if (props.modelValue === null || props.modelValue === undefined)
    return fragment === separators.decimal ? fragment : '';
  return `${formatNumber(props.modelValue)}${fragment}`;
});

const onInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const raw = target.value;
  const caretBefore = target.selectionStart ?? raw.length;
  const { fragment, numeric } = parseAmountInput({
    raw,
    decimalSeparator: separators.decimal,
    groupSeparator: separators.group,
    decimals: props.decimals,
  });
  // A lone separator has no value yet but must stay on screen, or '.5' would land as 5.
  const isLoneSeparator = numeric === null && raw === separators.decimal && props.decimals > 0;
  trailingFragment.value = isLoneSeparator ? '.' : fragment;

  // '.5' renders as '0.5': count the added zero so the caret stays after the typed digit.
  const addedLeadingZero = numeric !== null && raw.startsWith(separators.decimal) && caretBefore > 0 ? 1 : 0;
  const digitsBeforeCaret =
    countDigitsBeforeCaret({
      text: raw,
      caret: caretBefore,
      decimalSeparator: separators.decimal,
    }) + addedLeadingZero;

  if (numeric !== props.modelValue) {
    emit('update:modelValue', numeric);
  }

  // displayValue reruns after the prop update, but the DOM refreshes only next tick — restore caret then.
  nextTick(() => {
    const formatted = displayValue.value;
    // Dropped digits that leave the value unchanged trigger no re-render, so the typed text would stay.
    if (inputRef.value && inputRef.value.value !== formatted) inputRef.value.value = formatted;
    const nextCaret = caretOffsetAfterDigits({
      text: formatted,
      digitCount: digitsBeforeCaret,
      decimalSeparator: separators.decimal,
    });
    inputRef.value?.setSelectionRange(nextCaret, nextCaret);
  });
};
</script>
