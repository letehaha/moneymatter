<template>
  <div
    :class="{
      'input-field--error': errorMessage,
      'input-field--disabled': disabled,
      relative: errorPlacement === 'absolute',
    }"
    class="input-field"
  >
    <FieldLabel :label="label" :only-template="nonLabelWrapper">
      <template v-if="$slots['label-after']" #label-after>
        <slot name="label-after" />
      </template>
      <template #label-right>
        <template v-if="$slots['label-right']">
          <slot name="label-right" />
        </template>
      </template>

      <div class="relative">
        <template v-if="$slots.iconLeading">
          <div :class="['absolute top-0 left-0 flex h-full items-center px-4', leadingIconCssClass]">
            <slot name="iconLeading" />
          </div>
        </template>

        <input
          v-bind="{
            step: type === 'number' ? 'any' : undefined,
            ...computedAttrs,
          }"
          ref="inputFieldRef"
          :type="type"
          :value="displayValue"
          :style="inputFieldStyles"
          :disabled="disabled"
          :tabindex="tabindex"
          :min="minValue"
          :placeholder="placeholder"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
          :class="
            cn(
              'border-input bg-input-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 md:h-9',
              $slots.iconTrailing && 'pr-12',
              $slots.iconLeading && 'pl-10',
              (computedAttrs.class as string) ?? '',
            )
          "
        />

        <template v-if="$slots.iconTrailing">
          <div :class="cn('absolute top-0 right-0 flex h-full items-center px-6', trailingIconCssClass)">
            <slot name="iconTrailing" />
          </div>
        </template>
      </div>
    </FieldLabel>

    <template v-if="$slots.subLabel">
      <div class="absolute top-0 right-0 text-base font-normal [&_a]:text-white [&_a]:no-underline">
        <slot name="subLabel" />
      </div>
    </template>

    <div v-if="errorPlacement === 'absolute'" class="absolute top-full left-0 w-full">
      <FieldError :error-message="errorMessage" />
    </div>
    <FieldError v-else :error-message="errorMessage" />
  </div>
</template>

<script lang="ts" setup>
import { cn } from '@/lib/utils';
import { HTMLAttributes, computed, onMounted, ref, useAttrs, watch } from 'vue';

import FieldError from './components/field-error.vue';
import FieldLabel from './components/field-label.vue';

enum MODEL_EVENTS {
  input = 'update:modelValue',
}

const props = defineProps<{
  label?: string;
  modelValue?: string | number | null;
  type?: string;
  disabled?: boolean;
  tabindex?: string;
  errorMessage?: string;
  /** `absolute` keeps the field's height fixed while the message shows; the parent must leave room below. */
  errorPlacement?: 'inline' | 'absolute';
  inputFieldStyles?: HTMLAttributes['style'];
  onlyPositive?: boolean;
  /**
   * Caps the decimals a `number` input keeps (the amount's currency decimals): digits typed or
   * pasted past the cap are dropped, and 0 drops the decimal point as well. Unset keeps any precision.
   */
  decimals?: number;
  autofocus?: boolean;
  trailingIconCssClass?: string;
  leadingIconCssClass?: string;
  placeholder?: string;
  /**
   * Wraps the field in a `div` instead of a `label`. Needed when `label-right` holds a clickable
   * control: it precedes the input in tree order, so a `label` would send every click to it.
   */
  nonLabelWrapper?: boolean;
}>();

const emits = defineEmits<{
  (e: MODEL_EVENTS.input, payload: string | number | null): void;
}>();

defineSlots<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  'label-right'(): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  'label-after'(): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subLabel(): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  iconTrailing(): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  iconLeading(): any;
}>();
const attrs = useAttrs();

// For number inputs, we need to track the raw string value separately
// to preserve intermediate states like "1234.0" while typing "1234.03"
const rawNumberInput = ref<string>('');

// Determines if a string represents an incomplete decimal number
// (ends with decimal point or trailing zeros after decimal that would be lost in Number conversion)
const isIncompleteDecimal = (value: string): boolean => {
  if (!value) return false;
  // Ends with decimal point (e.g., "1234.")
  if (value.endsWith('.')) return true;
  // Has decimal point and ends with zero (e.g., "1234.0", "1234.00", "1234.10")
  if (value.includes('.') && value.endsWith('0')) return true;
  return false;
};

// The value to display in the input
const displayValue = computed(() => {
  if (props.type === 'number') {
    // Prefer raw input when it's an incomplete decimal (e.g. "5." or "5.0")
    // or when the model value would display in scientific notation (e.g. 0.0000001 → "1e-7")
    if (rawNumberInput.value && (isIncompleteDecimal(rawNumberInput.value) || String(props.modelValue).includes('e'))) {
      return rawNumberInput.value;
    }
    // Otherwise show the model value
    return props.modelValue ?? '';
  }
  return props.modelValue ?? '';
});

// Sync rawNumberInput when modelValue changes externally
watch(
  () => props.modelValue,
  (newValue) => {
    if (props.type === 'number') {
      // Only update raw input if it's not an incomplete decimal being typed
      const numericRaw = rawNumberInput.value === '' ? null : Number(rawNumberInput.value);
      if (numericRaw !== newValue) {
        rawNumberInput.value = newValue != null ? String(newValue) : '';
      }
    }
  },
);

const limitDecimals = (raw: string): string => {
  const dot = raw.indexOf('.');
  if (props.decimals === undefined || dot === -1) return raw;
  return props.decimals === 0 ? raw.slice(0, dot) : raw.slice(0, dot + 1 + props.decimals);
};

const onInput = (event: Event) => {
  const target = event.target as HTMLInputElement;

  if (props.disabled) return;

  // For number inputs, preserve raw value to handle intermediate decimal states
  if (props.type === 'number') {
    const limited = limitDecimals(target.value);
    if (limited !== target.value) target.value = limited;
    rawNumberInput.value = limited;
    const numValue = limited === '' ? null : Number(limited);
    if (props.modelValue === numValue) return;
    emits(MODEL_EVENTS.input, numValue);
  } else {
    const value: string = target.value;
    if (props.modelValue === value) return;
    emits(MODEL_EVENTS.input, value);
  }
};

const onKeypress = (event: KeyboardEvent) => {
  if (props.disabled) return;

  if (props.type === 'number') {
    // Prevent scientific notation (e.g., 1e5)
    if (event.key === 'e' || event.key === 'E') {
      event.preventDefault();
    }
    // A whole-number currency has no decimal point to type.
    if (props.decimals === 0 && (event.key === '.' || event.key === ',')) {
      event.preventDefault();
    }
  }
  if (props.onlyPositive) {
    // Prevent negative numbers
    if (['-', '+', '='].includes(event.key)) {
      event.preventDefault();
    }
  }
};

// A focused number input changes its value on mouse wheel, so scrolling the page
// past a focused field silently mutates it. Blur on wheel: the value stays put and
// the wheel event still scrolls the page normally.
const onWheel = (event: WheelEvent) => {
  if (props.type === 'number' && document.activeElement === event.target) {
    (event.target as HTMLInputElement).blur();
  }
};

const computedAttrs = computed(() => ({
  ...attrs,
  class: attrs.class,
  onInput,
  onkeypress: onKeypress,
  onWheel,
}));

const inputFieldRef = ref<HTMLInputElement | null>(null);
const minValue = computed<number>(() => {
  if (props.onlyPositive && !attrs.min) {
    return 0;
  }
  if (Number(attrs.min) < 0) {
    return 0;
  }

  return Number(attrs.min);
});

onMounted(() => {
  if (props.autofocus) {
    inputFieldRef.value!.focus();
  }
});

defineExpose({
  focus: () => inputFieldRef.value?.focus(),
  select: () => inputFieldRef.value?.select(),
});
</script>

<style scoped>
/* Hide number input spinners */
input[type='number']::-webkit-outer-spin-button,
input[type='number']::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

input[type='number'] {
  -moz-appearance: textfield;
  appearance: textfield;
}
</style>
