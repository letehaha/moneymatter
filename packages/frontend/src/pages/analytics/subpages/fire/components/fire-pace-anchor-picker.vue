<template>
  <Popover v-model:open="isOpen">
    <PopoverTrigger as-child>
      <Button variant="outline" size="sm" class="tabular-nums" :aria-label="$t('analytics.fire.pace.picker.title')">
        <component :is="anchor.isRolling ? RefreshCwIcon : PinIcon" class="text-primary-text size-4" />
        {{ anchor.isRolling ? $t('analytics.fire.pace.picker.rollingLabel', { month: anchorLabel }) : anchorLabel }}
        <ChevronDownIcon class="text-muted-foreground size-4" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" class="w-78 p-3">
      <p class="text-muted-foreground mb-1.5 px-1 text-xs font-semibold tracking-wider uppercase">
        {{ $t('analytics.fire.pace.picker.title') }}
      </p>
      <Button
        variant="ghost"
        :class="
          cn(
            'h-auto w-full justify-start gap-3 px-2.5 py-2 text-left',
            anchor.isRolling && 'bg-primary/10 hover:bg-primary/10',
          )
        "
        :aria-pressed="anchor.isRolling"
        @click="pick({ month: null })"
      >
        <RefreshCwIcon class="text-primary-text size-4" />
        <span class="flex flex-1 flex-col">
          <span class="text-sm font-bold">{{ $t('analytics.fire.pace.picker.rolling') }}</span>
          <span class="text-muted-foreground text-xs font-normal tabular-nums">
            {{ $t('analytics.fire.pace.picker.rollingHint', { month: rollingLabel }) }}
          </span>
        </span>
        <CheckIcon v-if="anchor.isRolling" class="text-primary-text size-4" />
      </Button>

      <Separator class="my-2" />

      <div class="flex items-center justify-between pb-1.5 pl-2.5">
        <span class="flex flex-col">
          <span class="text-sm font-bold">{{ $t('analytics.fire.pace.picker.specific') }}</span>
          <span class="text-muted-foreground text-xs">{{ $t('analytics.fire.pace.picker.specificHint') }}</span>
        </span>
        <span class="flex items-center">
          <DesktopOnlyTooltip :content="$t('analytics.fire.pace.picker.prevYear')">
            <Button
              variant="ghost"
              size="icon-sm"
              :aria-label="$t('analytics.fire.pace.picker.prevYear')"
              :disabled="year <= minYear"
              @click="year -= 1"
            >
              <ChevronLeftIcon class="size-4" />
            </Button>
          </DesktopOnlyTooltip>
          <span class="min-w-10 text-center text-sm font-bold tabular-nums">{{ year }}</span>
          <DesktopOnlyTooltip :content="$t('analytics.fire.pace.picker.nextYear')">
            <Button
              variant="ghost"
              size="icon-sm"
              :aria-label="$t('analytics.fire.pace.picker.nextYear')"
              :disabled="year >= maxYear"
              @click="year += 1"
            >
              <ChevronRightIcon class="size-4" />
            </Button>
          </DesktopOnlyTooltip>
        </span>
      </div>

      <div class="grid grid-cols-4 gap-1">
        <Button
          v-for="m in months"
          :key="m.key"
          :variant="m.isSelected ? 'default' : 'ghost'"
          :class="cn('px-3', m.isRolling && 'ring-primary text-primary-text ring-1 ring-inset')"
          :disabled="m.disabled"
          :aria-pressed="m.isSelected"
          :aria-label="m.ariaLabel"
          @click="pick({ month: m.key })"
        >
          {{ m.label }}
        </Button>
      </div>

      <p v-if="earliestLabel" class="text-muted-foreground mt-2.5 px-1 text-xs">
        {{ $t('analytics.fire.pace.picker.earliest', { month: earliestLabel }) }}
      </p>
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { Separator } from '@/components/lib/ui/separator';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { type FirePaceAnchor, monthKey, parseMonthKey, resolvePaceAnchor } from '@/composable/fire/fire-pace';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, PinIcon, RefreshCwIcon } from '@lucide/vue';
import { getYear, setMonth, startOfMonth, subMonths } from 'date-fns';
import { computed, ref, watch } from 'vue';

const MONTHS_IN_YEAR = 12;

const props = defineProps<{ anchor: FirePaceAnchor; earliestMonth: string | null }>();
const emit = defineEmits<{ 'change-anchor': [month: string | null] }>();

const { format } = useDateLocale();

const now = new Date();
const latestMonth = monthKey({ date: subMonths(startOfMonth(now), 1) });
const rolling = resolvePaceAnchor({ paceAnchor: null, now });

const isOpen = ref(false);
const year = ref(getYear(props.anchor.date));
watch(isOpen, (open) => {
  if (open) year.value = getYear(props.anchor.date);
});

const anchorLabel = computed(() => format(props.anchor.date, 'LLL yyyy'));
const rollingLabel = computed(() => format(rolling.date, 'LLL yyyy'));
const earliestLabel = computed(() =>
  props.earliestMonth ? format(parseMonthKey({ month: props.earliestMonth })!, 'LLL yyyy') : null,
);

const minYear = computed(() =>
  props.earliestMonth ? getYear(parseMonthKey({ month: props.earliestMonth })!) : getYear(now) - 10,
);
const maxYear = getYear(parseMonthKey({ month: latestMonth })!);

const months = computed(() =>
  Array.from({ length: MONTHS_IN_YEAR }, (_, index) => {
    const date = setMonth(new Date(year.value, 0, 1), index);
    const key = monthKey({ date });
    return {
      key,
      label: format(date, 'LLL'),
      ariaLabel: format(date, 'LLLL yyyy'),
      disabled: key > latestMonth || (props.earliestMonth !== null && key < props.earliestMonth),
      isSelected: !props.anchor.isRolling && key === props.anchor.month,
      isRolling: props.anchor.isRolling && key === rolling.month,
    };
  }),
);

const pick = ({ month }: { month: string | null }) => {
  isOpen.value = false;
  emit('change-anchor', month);
};
</script>
