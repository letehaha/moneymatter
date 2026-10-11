<script setup lang="ts">
import ResponsivePopover from '@/components/common/responsive-popover.vue';
import { Button } from '@/components/lib/ui/button';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { StatusBadge } from '@/components/lib/ui/status-badge';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import type { BudgetPlanPeriod } from '@bt/shared/types';
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';

import { formatPeriodLabel, formatPeriodShortLabel } from '../helpers';

const props = defineProps<{
  periods: BudgetPlanPeriod[];
  selectedId?: string;
  /** Narrow headers: short trigger label and a dot for the current period. The list keeps full labels. */
  compact?: boolean;
}>();
const emit = defineEmits<{ select: [periodId: string] }>();

const { locale } = useDateLocale();

const isOpen = ref(false);
const listRef = ref<HTMLElement | null>(null);

const selectedIndex = computed(() => props.periods.findIndex((period) => period.id === props.selectedId));
const selectedPeriod = computed(() => props.periods[selectedIndex.value]);

const labelOf = ({ period }: { period: BudgetPlanPeriod }) => formatPeriodLabel({ ...period, locale: locale.value });

const pick = ({ periodId }: { periodId: string }) => {
  isOpen.value = false;
  emit('select', periodId);
};

const step = ({ offset }: { offset: number }) => {
  const period = props.periods[selectedIndex.value + offset];
  if (period) emit('select', period.id);
};

watch([isOpen, listRef], ([open, list]) => {
  if (!open) return;
  const selected = list?.querySelector<HTMLElement>('[aria-current="true"]');
  selected?.focus({ preventScroll: true });
  selected?.scrollIntoView({ block: 'nearest' });
});
</script>

<template>
  <div :class="cn('flex min-w-0 items-center', compact ? 'gap-0' : 'gap-1')">
    <DesktopOnlyTooltip :content="$t('budgetPlans.period.previous')">
      <Button
        variant="ghost"
        size="icon-sm"
        class="shrink-0"
        :disabled="selectedIndex <= 0"
        :aria-label="$t('budgetPlans.period.previous')"
        @click="step({ offset: -1 })"
      >
        <ChevronLeftIcon class="size-4" />
      </Button>
    </DesktopOnlyTooltip>

    <ResponsivePopover
      align="end"
      v-model:open="isOpen"
      :title="$t('budgetPlans.period.pickerTitle')"
      content-class="w-max min-w-48 p-1"
    >
      <template #trigger>
        <Button variant="ghost" size="sm" class="px-2 text-base font-semibold" :disabled="!selectedPeriod">
          <template v-if="compact">
            <span class="truncate tabular-nums">
              {{ selectedPeriod ? formatPeriodShortLabel({ ...selectedPeriod, locale }) : '' }}
            </span>
            <span v-if="selectedPeriod?.isCurrent" class="bg-primary size-1.5 shrink-0 rounded-full">
              <span class="sr-only">{{ $t('budgetPlans.period.current') }}</span>
            </span>
          </template>
          <template v-else>
            <span class="truncate tabular-nums">{{ selectedPeriod ? labelOf({ period: selectedPeriod }) : '' }}</span>
            <StatusBadge v-if="selectedPeriod?.isCurrent" variant="info">
              {{ $t('budgetPlans.period.current') }}
            </StatusBadge>
          </template>
          <ChevronDownIcon class="text-muted-foreground size-4" />
        </Button>
      </template>

      <ScrollArea class="max-h-80" viewport-class="max-h-80">
        <div ref="listRef" class="grid gap-0.5">
          <Button
            v-for="period in periods"
            :key="period.id"
            variant="ghost"
            size="sm"
            :aria-current="period.id === selectedId ? 'true' : undefined"
            :class="cn('justify-start font-normal', period.id === selectedId && 'bg-accent text-accent-foreground')"
            @click="pick({ periodId: period.id })"
          >
            <CheckIcon :class="cn('size-4', period.id !== selectedId && 'invisible')" />
            <span class="tabular-nums">{{ labelOf({ period }) }}</span>
            <StatusBadge v-if="period.isCurrent" variant="info" class="ml-auto">
              {{ $t('budgetPlans.period.current') }}
            </StatusBadge>
          </Button>
        </div>
      </ScrollArea>
    </ResponsivePopover>

    <DesktopOnlyTooltip :content="$t('budgetPlans.period.next')">
      <Button
        variant="ghost"
        size="icon-sm"
        class="shrink-0"
        :disabled="selectedIndex < 0 || selectedIndex >= periods.length - 1"
        :aria-label="$t('budgetPlans.period.next')"
        @click="step({ offset: 1 })"
      >
        <ChevronRightIcon class="size-4" />
      </Button>
    </DesktopOnlyTooltip>
  </div>
</template>
