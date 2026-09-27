<template>
  <div
    :class="{
      'date-field--error': errorMessage,
      'date-field--disabled': disabled,
    }"
    class="relative w-full flex-1"
  >
    <Popover.Popover v-model:open="isPopoverOpen">
      <FieldLabel :label="label">
        <template v-if="$slots['label-after']" #label-after>
          <slot name="label-after" />
        </template>
        <div class="relative">
          <input
            :value="inputValue"
            type="datetime-local"
            :disabled="disabled"
            :class="
              cn(
                'datetime-local-raw-input',
                // Keep px-3: extra right padding pushes Firefox's native picker
                // icon out from under the addon overlay that covers it.
                'border-input bg-input-background ring-offset-background flex h-10 w-full rounded-md border px-3 py-2 text-sm md:h-9',
                'file:border-0 file:bg-transparent file:text-sm file:font-medium',
                'placeholder:text-muted-foreground',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden',
                'disabled:cursor-not-allowed disabled:opacity-50',
                'appearance-none', // fixes Safari width issues
                $attrs.class ?? '',
              )
            "
            @input="handleLocalInputUpdate"
            @blur="handleBlur"
          />

          <!-- Keep this overlay opaque: it covers the native picker icon Firefox
               draws inside datetime-local inputs, which no CSS pseudo-element hides.
               Disabled on Safari mobile so taps fall through to the native picker. -->
          <Popover.PopoverTrigger as-child>
            <Button
              class="border-input bg-muted text-muted-foreground hover:border-primary/50 hover:bg-muted hover:text-primary-text absolute top-0 right-0 flex h-10 w-12 items-center justify-center rounded-l-none rounded-r-md border md:h-9"
              variant="ghost"
              size="icon"
              :disabled="disabled || isSafariMobile"
            >
              <CalendarClockIcon class="size-5" />
            </Button>
          </Popover.PopoverTrigger>
        </div>
        <FieldError :error-message="errorMessage" />
        <Popover.PopoverContent class="w-87.5">
          <Calendar v-model="localValue" v-bind="calendarOptions" mode="dateTime" is24hr type="single" />
        </Popover.PopoverContent>
      </FieldLabel>
    </Popover.Popover>
  </div>
</template>

<script setup lang="ts">
import { FieldError, FieldLabel } from '@/components/fields';
import { Button } from '@/components/lib/ui/button';
import { Calendar } from '@/components/lib/ui/calendar';
import * as Popover from '@/components/lib/ui/popover';
import { useSafariDetection } from '@/composable/detect-safari';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { CalendarClockIcon } from '@lucide/vue';
import { ref, watch } from 'vue';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    label?: string;
    modelValue?: Date;
    type?: string;
    tabindex?: string;
    errorMessage?: string;
    inputFieldStyles?: Record<string, string>;
    disabled?: boolean;
    calendarOptions?: {
      minDate?: Date;
      maxDate?: Date;
    };
  }>(),
  {
    label: undefined,
    modelValue: undefined,
    type: undefined,
    tabindex: undefined,
    errorMessage: undefined,
    inputFieldStyles: undefined,
    disabled: false,
    calendarOptions: undefined,
  },
);

const { isSafariMobile } = useSafariDetection();

// Typing a year in a datetime-local input emits parseable intermediate values
// (0026 while aiming for 2026). Dates before 2000 are those or typos, never real.
const MIN_DATE = new Date('2000-01-01T00:00:00');

const isValidDate = (value: unknown): value is Date =>
  value instanceof Date && !isNaN(value.getTime()) && value >= MIN_DATE;

const formatToInput = (value: Date) => format(value, 'yyyy-MM-dd HH:mm');

const inputValue = ref(props.modelValue ? formatToInput(props.modelValue) : '');

const emit = defineEmits<{
  (e: 'update:modelValue', payload: Date): void;
}>();
const localValue = ref<Date>(props.modelValue ?? new Date());
const isPopoverOpen = ref(false);

// Safari mobile uses the native picker; the calendar trigger is disabled there too.
defineExpose({
  open: () => {
    if (!isSafariMobile) isPopoverOpen.value = true;
  },
});

const handleLocalInputUpdate = (event: Event) => {
  const inputVal = (event.target as HTMLInputElement).value;

  // Always update the displayed input value so user can see what they're typing
  inputValue.value = inputVal;

  // Only emit the date if it's a valid date string
  if (inputVal && isValidDate(new Date(inputVal))) {
    emit('update:modelValue', new Date(inputVal));
  }
  // For invalid intermediate states, don't emit anything
  // This prevents validation errors during typing
};

const handleBlur = (event: FocusEvent) => {
  const inputVal = (event.target as HTMLInputElement).value;

  // On blur, validate the final input value
  if (inputVal && isValidDate(new Date(inputVal))) {
    // Valid date - emit it
    emit('update:modelValue', new Date(inputVal));
  } else if (inputVal) {
    // Invalid date - revert to last valid value
    inputValue.value = props.modelValue ? formatToInput(props.modelValue) : '';
  }
  // If empty, keep it empty
};

watch(
  () => props.modelValue,
  (value) => {
    inputValue.value = value ? formatToInput(value) : '';
    if (isValidDate(value)) localValue.value = value;
  },
);

watch(localValue, (value, previousValue) => {
  // v-calendar clears its model when the already-selected day is tapped. The emit
  // contract is a Date, so put the selection back instead of passing null on.
  if (!isValidDate(value)) {
    localValue.value = isValidDate(previousValue) ? previousValue : (props.modelValue ?? new Date());
    return;
  }
  // That restore re-enters this watcher; it is not a user pick.
  if (!isValidDate(previousValue)) return;

  emit('update:modelValue', value);
  isPopoverOpen.value = false;
});
</script>
