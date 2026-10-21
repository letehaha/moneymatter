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
            'border-input bg-input-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 md:h-9',
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
  DEFAULT_AMOUNT_DECIMALS,
  caretOffsetAfterDigits,
  countDigitsBeforeCaret,
  getAmountSeparators,
  parseAmountInput,
} from '@/components/fields/utils/formatted-amount';
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
    decimals?: number;
  }>(),
  {
    label: undefined,
    placeholder: undefined,
    errorMessage: undefined,
    decimals: DEFAULT_AMOUNT_DECIMALS,
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

// Locale grouping/decimal separators, matching the rest of the app's number rendering.
const formatter = computed(
  () =>
    new Intl.NumberFormat(undefined, {
      maximumFractionDigits: props.decimals,
      minimumFractionDigits: 0,
    }),
);

const formatNumber = (value: number): string => {
  if (Number.isNaN(value)) return '';
  return formatter.value.format(value);
};

const displayValue = computed(() => {
  if (props.modelValue === null || props.modelValue === undefined) return '';
  // fragment uses a canonical '.' — swap in the locale's decimal separator to match the formatter.
  const fragment = trailingFragment.value.replace('.', separators.decimal);
  return `${formatNumber(props.modelValue)}${fragment}`;
});

const onInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const raw = target.value;
  const caretBefore = target.selectionStart ?? raw.length;
  const digitsBeforeCaret = countDigitsBeforeCaret({
    text: raw,
    caret: caretBefore,
    decimalSeparator: separators.decimal,
  });

  const { fragment, numeric } = parseAmountInput({
    raw,
    decimalSeparator: separators.decimal,
    groupSeparator: separators.group,
    decimals: props.decimals,
  });
  trailingFragment.value = fragment;

  if (numeric !== props.modelValue) {
    emit('update:modelValue', numeric);
  }

  // displayValue reruns after the prop update, but the DOM refreshes only next tick — restore caret then.
  nextTick(() => {
    const formatted = displayValue.value;
    const nextCaret = caretOffsetAfterDigits({
      text: formatted,
      digitCount: digitsBeforeCaret,
      decimalSeparator: separators.decimal,
    });
    inputRef.value?.setSelectionRange(nextCaret, nextCaret);
  });
};
</script>
