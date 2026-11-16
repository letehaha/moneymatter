<script lang="ts" setup>
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import { computed } from 'vue';

import ScrollArea from '../scroll-area/ScrollArea.vue';
import { SCROLL_AREA_IDS } from '../scroll-area/types';
import { getCellLabels, getGridColumns, isFutureCell } from './date-selector-utils';
import { type CellState, type DateSelectorPeriodType } from './types';

const props = defineProps<{
  periodType: DateSelectorPeriodType;
  years: number[];
  getCellState: (params: { year: number; index: number }) => CellState;
}>();

const emit = defineEmits<{
  selectCell: [params: { year: number; index: number }];
}>();

const { format } = useDateLocale();

const columns = computed(() => getGridColumns({ periodType: props.periodType }));

const cellBase = 'h-9 rounded-md border text-sm font-medium transition-colors hover:bg-hover';

function getCellClasses({ year, index }: { year: number; index: number }): Record<string, boolean> {
  const state = props.getCellState({ year, index });
  return {
    'bg-primary text-primary-foreground hover:bg-primary/90 border-transparent':
      state.isSelected && !state.isRangeStart && !state.isRangeEnd,
    'bg-accent hover:bg-accent text-accent-foreground rounded-none border-transparent': state.isInRange,
    'bg-primary text-primary-foreground hover:bg-primary/90 rounded-r-none border-transparent':
      state.isRangeStart && !state.isRangeEnd,
    'bg-primary text-primary-foreground hover:bg-primary/90 rounded-l-none border-transparent':
      state.isRangeEnd && !state.isRangeStart,
    'border-border': !state.isSelected && !state.isInRange && !state.isRangeStart && !state.isRangeEnd,
    'pointer-events-none opacity-50': state.isDisabled,
  };
}
</script>

<template>
  <ScrollArea :scroll-area-id="SCROLL_AREA_IDS.dateSelectorPanel" class="h-full max-h-80">
    <div class="space-y-4 p-1">
      <template v-if="periodType === 'year'">
        <div class="grid gap-2" :style="{ gridTemplateColumns: `repeat(${columns}, 1fr)` }">
          <button
            v-for="year in years"
            v-show="!isFutureCell({ periodType, year, index: 0 })"
            :key="year"
            type="button"
            :class="cn(cellBase, getCellClasses({ year, index: 0 }))"
            @click="emit('selectCell', { year, index: 0 })"
          >
            {{ year }}
          </button>
        </div>
      </template>

      <template v-else>
        <div v-for="year in years" :key="year" class="space-y-2">
          <div class="text-muted-foreground text-xs font-semibold">
            {{ year }}
          </div>
          <div class="grid gap-2" :style="{ gridTemplateColumns: `repeat(${columns}, 1fr)` }">
            <button
              v-for="cell in getCellLabels({ periodType, year, formatFn: format })"
              v-show="!isFutureCell({ periodType, year, index: cell.index })"
              :key="cell.index"
              type="button"
              :class="cn(cellBase, getCellClasses({ year, index: cell.index }))"
              @click="emit('selectCell', { year, index: cell.index })"
            >
              {{ cell.label }}
            </button>
          </div>
        </div>
      </template>
    </div>
  </ScrollArea>
</template>
