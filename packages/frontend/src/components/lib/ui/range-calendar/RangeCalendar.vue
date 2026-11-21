<script lang="ts" setup>
import { i18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { CalendarDate, type DateValue } from '@internationalized/date';
import {
  RangeCalendarRoot,
  type RangeCalendarRootEmits,
  type RangeCalendarRootProps,
  useForwardPropsEmits,
} from 'reka-ui';
import { type HTMLAttributes, computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import Button from '../button/Button.vue';
import { Popover, PopoverContent, PopoverTrigger } from '../popover';
import {
  RangeCalendarCell,
  RangeCalendarCellTrigger,
  RangeCalendarGrid,
  RangeCalendarGridBody,
  RangeCalendarGridHead,
  RangeCalendarGridRow,
  RangeCalendarHeadCell,
  RangeCalendarHeader,
  RangeCalendarHeading,
  RangeCalendarNextButton,
  RangeCalendarPrevButton,
} from '../range-calendar';
import { ScrollArea } from '../scroll-area';
import { SCROLL_AREA_IDS } from '../scroll-area/types';

const props = defineProps<RangeCalendarRootProps & { class?: HTMLAttributes['class'] }>();

const emits = defineEmits<RangeCalendarRootEmits>();

const { t } = useI18n();

// --- Quick-jump popover state ---
const calendarPlaceholder = ref<DateValue>();
const isJumpPopoverOpen = ref(false);
const selectedMonth = ref(0);
const selectedYear = ref(new Date().getFullYear());

// Reactive locale for reka-ui calendar - tracks i18n locale changes
const calendarLocale = computed(() => {
  // Access the reactive locale value to ensure reactivity (locale is same as getCurrentLocale())
  return i18n.global.locale.value;
});

const monthNames = computed(() => {
  const formatter = new Intl.DateTimeFormat(calendarLocale.value, { month: 'long' });
  return Array.from({ length: 12 }, (_, i) => formatter.format(new Date(2000, i, 1)));
});

function formatHeading({ grid }: { grid: Array<{ value: DateValue }> }): string {
  const formatter = new Intl.DateTimeFormat(calendarLocale.value, { month: 'short' });
  if (grid.length === 1) {
    const date = new Date(grid[0]!.value.year, grid[0]!.value.month - 1);
    return `${formatter.format(date)} ${grid[0]!.value.year}`;
  }
  const first = grid[0]!.value;
  const last = grid[grid.length - 1]!.value;
  const firstMonth = formatter.format(new Date(first.year, first.month - 1));
  const lastMonth = formatter.format(new Date(last.year, last.month - 1));
  if (first.year === last.year) {
    return `${firstMonth} \u2013 ${lastMonth} ${first.year}`;
  }
  return `${firstMonth} ${first.year} \u2013 ${lastMonth} ${last.year}`;
}

const YEAR_MIN = 2000;
const yearRange = computed(() => {
  const max = new Date().getFullYear();
  const years: number[] = [];
  for (let y = max; y >= YEAR_MIN; y--) {
    years.push(y);
  }
  return years;
});

function onPopoverOpen(open: boolean) {
  if (open) {
    if (calendarPlaceholder.value) {
      selectedMonth.value = calendarPlaceholder.value.month - 1;
      selectedYear.value = calendarPlaceholder.value.year;
    } else {
      const now = new Date();
      selectedMonth.value = now.getMonth();
      selectedYear.value = now.getFullYear();
    }
  }
  isJumpPopoverOpen.value = open;
}

function applyJump() {
  calendarPlaceholder.value = new CalendarDate(selectedYear.value, selectedMonth.value + 1, 1);
  isJumpPopoverOpen.value = false;
}

const delegatedProps = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { class: _, placeholder: _placeholder, ...delegated } = props;

  return {
    ...delegated,
    locale: calendarLocale.value,
  };
});

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <RangeCalendarRoot
    v-slot="{ grid, weekDays }"
    v-model:placeholder="calendarPlaceholder"
    :class="cn(props.numberOfMonths === 1 && 'mx-auto max-w-95', props.class)"
    v-bind="forwarded"
  >
    <RangeCalendarHeader>
      <RangeCalendarPrevButton />

      <Popover :open="isJumpPopoverOpen" @update:open="onPopoverOpen">
        <PopoverTrigger as-child>
          <button type="button" class="hover:text-foreground/80 cursor-pointer transition-colors">
            <RangeCalendarHeading v-slot class="text-sm font-medium">
              {{ formatHeading({ grid }) }}
            </RangeCalendarHeading>
          </button>
        </PopoverTrigger>

        <PopoverContent class="w-auto p-3" :side-offset="8" @keydown.enter="applyJump">
          <div class="flex gap-4">
            <!-- Month list -->
            <ScrollArea :scroll-area-id="SCROLL_AREA_IDS.calendarJumpMonths" class="h-56">
              <div class="flex flex-col gap-0.5 pr-3">
                <button
                  v-for="(name, i) in monthNames"
                  :key="i"
                  type="button"
                  :class="
                    cn(
                      'focus-visible:bg-hover focus-visible:ring-ring rounded-md px-3 py-1 text-left text-sm capitalize transition-colors focus-visible:ring-2 focus-visible:outline-none',
                      i === selectedMonth
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'hover:bg-hover hover:text-accent-foreground',
                    )
                  "
                  @click="selectedMonth = i"
                >
                  {{ name }}
                </button>
              </div>
            </ScrollArea>

            <!-- Year list -->
            <ScrollArea :scroll-area-id="SCROLL_AREA_IDS.calendarJumpYears" class="h-56">
              <div class="flex flex-col gap-0.5 pr-3">
                <button
                  v-for="y in yearRange"
                  :key="y"
                  :ref="
                    (el) => {
                      if (y === selectedYear && el) (el as HTMLElement).scrollIntoView({ block: 'center' });
                    }
                  "
                  type="button"
                  :class="
                    cn(
                      'focus-visible:bg-hover focus-visible:ring-ring rounded-md px-3 py-1 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none',
                      y === selectedYear
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'hover:bg-hover hover:text-accent-foreground',
                    )
                  "
                  @click="selectedYear = y"
                >
                  {{ y }}
                </button>
              </div>
            </ScrollArea>
          </div>

          <div class="mt-3 border-t pt-3">
            <Button size="sm" variant="secondary" class="w-full" @click="applyJump">{{
              t('common.dateSelector.apply')
            }}</Button>
          </div>
        </PopoverContent>
      </Popover>

      <RangeCalendarNextButton />
    </RangeCalendarHeader>

    <div class="mt-4 flex flex-col gap-y-4 sm:flex-row sm:gap-x-4 sm:gap-y-0">
      <RangeCalendarGrid v-for="month in grid" :key="month.value.toString()">
        <RangeCalendarGridHead>
          <RangeCalendarGridRow>
            <RangeCalendarHeadCell v-for="day in weekDays" :key="day">
              {{ day }}
            </RangeCalendarHeadCell>
          </RangeCalendarGridRow>
        </RangeCalendarGridHead>
        <RangeCalendarGridBody>
          <RangeCalendarGridRow v-for="(weekDates, index) in month.rows" :key="`weekDate-${index}`" class="mt-2 w-full">
            <RangeCalendarCell v-for="weekDate in weekDates" :key="weekDate.toString()" :date="weekDate">
              <RangeCalendarCellTrigger :day="weekDate" :month="month.value" />
            </RangeCalendarCell>
          </RangeCalendarGridRow>
        </RangeCalendarGridBody>
      </RangeCalendarGrid>
    </div>
  </RangeCalendarRoot>
</template>
