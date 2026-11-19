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
          <!-- Without a 4-digit-year max, Chrome accepts 6-digit years and never auto-advances past the year segment. -->
          <input
            :value="inputValue"
            :type="isDateOnlyInput ? 'date' : 'datetime-local'"
            :max="nativeMax"
            :min="nativeMin"
            :disabled="disabled"
            :class="
              cn(
                'datetime-local-raw-input peer',
                // Keep px-3: extra right padding pushes Firefox's native picker
                // icon out from under the addon overlay that covers it.
                'border-input bg-input-background ring-offset-background flex w-full rounded-md border px-3 py-2 text-sm',
                'file:border-0 file:bg-transparent file:text-sm file:font-medium',
                'placeholder:text-muted-foreground',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden',
                'disabled:cursor-not-allowed disabled:opacity-50',
                'appearance-none', // fixes Safari width issues
                controlHeight[size],
                $attrs.class ?? '',
              )
            "
            @input="handleLocalInputUpdate"
            @blur="handleBlur"
          />

          <!-- Opaque instead of padding the input, so Firefox's native icon stays under the trigger. -->
          <Button
            v-if="clearable && modelValue && !disabled"
            type="button"
            variant="ghost"
            size="icon-sm"
            class="text-muted-foreground hover:text-foreground absolute top-1/2 right-12 -translate-y-1/2 bg-(--color-input-background) peer-focus:bg-(--input-background) hover:bg-(--color-input-background) hover:bg-[linear-gradient(var(--color-hover),var(--color-hover))] peer-focus:hover:bg-(--input-background)"
            :aria-label="$t('common.actions.clear')"
            @click="emit('clear')"
          >
            <XIcon class="size-4" />
          </Button>

          <!-- Keep this overlay opaque: it covers the native picker icon Firefox
               draws inside datetime-local inputs, which no CSS pseudo-element hides.
               Disabled where Safari mobile's native picker covers it, so taps fall through. -->
          <Popover.PopoverTrigger as-child>
            <Button
              :class="
                cn(
                  'border-input bg-muted text-muted-foreground hover:border-primary/50 hover:bg-muted hover:text-primary-text absolute top-0 right-0 flex w-12 items-center justify-center rounded-l-none rounded-r-md border',
                  controlHeight[size],
                )
              "
              variant="ghost"
              size="icon"
              :disabled="disabled || !isPopoverAvailable"
            >
              <CalendarClockIcon class="size-5" />
            </Button>
          </Popover.PopoverTrigger>
        </div>
        <FieldError :error-message="errorMessage" />
        <Popover.PopoverContent class="w-87.5">
          <Calendar v-model="localValue" v-bind="calendarOptions" :mode="mode" is24hr type="single" />
        </Popover.PopoverContent>
      </FieldLabel>
    </Popover.Popover>
  </div>
</template>

<script setup lang="ts">
import FieldError from '@/components/fields/components/field-error.vue';
import FieldLabel from '@/components/fields/components/field-label.vue';
import { Button } from '@/components/lib/ui/button';
import { Calendar } from '@/components/lib/ui/calendar';
import { type ControlSize, controlHeight } from '@/components/lib/ui/control-size';
import * as Popover from '@/components/lib/ui/popover';
import { useSafariDetection } from '@/composable/detect-safari';
import { cn } from '@/lib/utils';
import { format, getDate, getMonth, getYear, isSameDay, parse, set } from 'date-fns';
import { CalendarClockIcon, XIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';

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
    mode?: 'date' | 'dateTime';
    clearable?: boolean;
    /** The input shows only the date; the time stays editable in the calendar popover. */
    hideInputTime?: boolean;
    size?: ControlSize;
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
    mode: 'dateTime',
    clearable: false,
    hideInputTime: false,
    size: 'default',
  },
);

const { isSafariMobile } = useSafariDetection();

// Typing a year in a datetime-local input emits parseable intermediate values
// (0026 while aiming for 2026). Dates before 2000 are those or typos, never real.
const MIN_DATE = new Date('2000-01-01T00:00:00');

const isValidDate = (value: unknown): value is Date =>
  value instanceof Date && !isNaN(value.getTime()) && value >= MIN_DATE;

const DATE_PATTERN = 'yyyy-MM-dd';

const isDateOnlyInput = computed(() => props.mode === 'date' || props.hideInputTime);
// Safari mobile relies on its native picker, except when the input hides the time the popover still sets.
const isPopoverAvailable = computed(() => !isSafariMobile || (props.hideInputTime && props.mode !== 'date'));

const formatToInput = (value: Date) => format(value, isDateOnlyInput.value ? DATE_PATTERN : 'yyyy-MM-dd HH:mm');

// `new Date('yyyy-MM-dd')` is UTC midnight, the previous day in negative-offset timezones.
const parseInput = ({ value }: { value: string }) => {
  if (!isDateOnlyInput.value) return new Date(value);
  const date = parse(value, DATE_PATTERN, new Date());
  if (props.mode === 'date' || !props.modelValue) return date;
  return set(props.modelValue, { year: getYear(date), month: getMonth(date), date: getDate(date) });
};

const nativeMax = computed(() => {
  if (!isDateOnlyInput.value) return '9999-12-31T23:59';
  const maxDate = props.calendarOptions?.maxDate;
  return maxDate ? format(maxDate, DATE_PATTERN) : '9999-12-31';
});
const nativeMin = computed(() => {
  const minDate = isDateOnlyInput.value ? props.calendarOptions?.minDate : undefined;
  return minDate ? format(minDate, DATE_PATTERN) : undefined;
});

const inputValue = ref(props.modelValue ? formatToInput(props.modelValue) : '');

const emit = defineEmits<{
  (e: 'update:modelValue', payload: Date): void;
  (e: 'clear'): void;
}>();
const localValue = ref<Date | null>(props.modelValue ?? (props.clearable ? null : new Date()));
const isPopoverOpen = ref(false);

defineExpose({
  open: () => {
    if (isPopoverAvailable.value) isPopoverOpen.value = true;
  },
});

const handleLocalInputUpdate = (event: Event) => {
  const inputVal = (event.target as HTMLInputElement).value;

  // Always update the displayed input value so user can see what they're typing
  inputValue.value = inputVal;

  // Only emit the date if it's a valid date string
  if (inputVal && isValidDate(parseInput({ value: inputVal }))) {
    emit('update:modelValue', parseInput({ value: inputVal }));
  }
  // For invalid intermediate states, don't emit anything
  // This prevents validation errors during typing
};

const handleBlur = (event: FocusEvent) => {
  const inputVal = (event.target as HTMLInputElement).value;

  // On blur, validate the final input value
  if (inputVal && isValidDate(parseInput({ value: inputVal }))) {
    // Valid date - emit it
    emit('update:modelValue', parseInput({ value: inputVal }));
  } else if (inputVal) {
    // Invalid date - revert to last valid value
    inputValue.value = props.modelValue ? formatToInput(props.modelValue) : '';
  }
  // If empty, keep it empty
};

const isCleared = () => props.clearable && !props.modelValue;

watch(
  () => [props.modelValue, isDateOnlyInput.value] as const,
  ([value]) => {
    inputValue.value = value ? formatToInput(value) : '';
    if (isValidDate(value)) localValue.value = value;
    else if (isCleared()) localValue.value = null;
  },
);

watch(localValue, (value, previousValue) => {
  // v-calendar clears its model when the already-selected day is tapped. The emit
  // contract is a Date, so put the selection back instead of passing null on.
  if (!isValidDate(value)) {
    if (isCleared()) return;
    localValue.value = isValidDate(previousValue) ? previousValue : (props.modelValue ?? new Date());
    return;
  }
  // That restore re-enters this watcher; it is not a user pick.
  if (!isValidDate(previousValue) && !isCleared()) return;

  emit('update:modelValue', value);
  // The time picker emits on every hour/minute change; only a day pick finishes the selection.
  if (!isValidDate(previousValue) || !isSameDay(value, previousValue)) isPopoverOpen.value = false;
});
</script>
