<script setup lang="ts">
import { buttonVariants } from '@/components/lib/ui/button';
import { i18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useVModel } from '@vueuse/core';
import { ChevronLeft, ChevronRight } from '@lucide/vue';
import { DatePicker } from 'v-calendar';
import { computed, nextTick, onMounted, ref, useSlots } from 'vue';

import { isVCalendarSlot } from '../calendar';

/* Extracted from v-calendar */
interface SimpleDateParts {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
}
type DateSource = Date | string | number;
type DatePickerDate = DateSource | Partial<SimpleDateParts> | null;
interface DatePickerRangeObject {
  start: Exclude<DatePickerDate, null>;
  end: Exclude<DatePickerDate, null>;
}
type DatePickerModel = DatePickerDate | DatePickerRangeObject;

defineOptions({
  inheritAttrs: false,
});

const props = withDefaults(
  defineProps<{
    modelValue?: string | number | Date | DatePickerModel;
    modelModifiers?: object;
    columns?: number;
    type?: 'single' | 'range';
  }>(),
  {
    type: 'single',
    columns: 1,
    modelValue: undefined,
    modelModifiers: undefined,
  },
);
const emits = defineEmits<{
  (e: 'update:modelValue', payload: typeof props.modelValue): void;
}>();

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: true,
});

const datePicker = ref<InstanceType<typeof DatePicker>>();
// In this current version of v-calendar has the calendarRef instance, which is
// required to handle arrow nav.
const calendarRef = computed(() => datePicker.value!.calendarRef);

function handleNav(direction: 'prev' | 'next') {
  if (!calendarRef.value) return;

  if (direction === 'prev') calendarRef.value.movePrev();
  else calendarRef.value.moveNext();
}

onMounted(async () => {
  await nextTick();
  if (modelValue.value instanceof Date && calendarRef.value) calendarRef.value.focusDate(modelValue.value);
});

// Reactive locale for v-calendar - tracks i18n locale changes
const calendarLocale = computed(() => {
  // Access the reactive locale value to ensure reactivity (locale is same as getCurrentLocale())
  return i18n.global.locale.value;
});

const $slots = useSlots();
const vCalendarSlots = computed(() =>
  Object.keys($slots)
    .filter((name) => isVCalendarSlot(name))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .reduce((obj: Record<string, any>, key: string) => {
      // eslint-disable-next-line no-param-reassign
      obj[key] = $slots[key];
      return obj;
    }, {}),
);
</script>

<template>
  <div class="relative">
    <div v-if="$attrs.mode !== 'time'" class="absolute top-3 z-1 flex w-full justify-between px-4">
      <button
        type="button"
        :class="
          cn(
            buttonVariants({ variant: 'outline' }),
            'size-7 bg-transparent p-0 opacity-50 shadow-none hover:opacity-100',
          )
        "
        @click="handleNav('prev')"
      >
        <ChevronLeft class="size-4" />
      </button>
      <button
        type="button"
        :class="
          cn(
            buttonVariants({ variant: 'outline' }),
            'size-7 bg-transparent p-0 opacity-50 shadow-none hover:opacity-100',
          )
        "
        @click="handleNav('next')"
      >
        <ChevronRight class="size-4" />
      </button>
    </div>

    <DatePicker
      ref="datePicker"
      v-model="modelValue"
      v-bind="$attrs"
      :model-modifiers="modelModifiers"
      :locale="calendarLocale"
      class="calendar"
      trim-weeks
      :transition="'none'"
      :columns="columns"
    >
      <template v-for="(_, slot) of vCalendarSlots" #[slot]="scope">
        <slot :name="slot" v-bind="scope" />
      </template>
    </DatePicker>
  </div>
</template>
