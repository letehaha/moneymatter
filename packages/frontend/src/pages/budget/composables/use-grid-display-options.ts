import { useLocalStorage } from '@vueuse/core';
import { computed } from 'vue';

export const ROW_BAR_MODES = ['spending', 'goal', 'combined', 'split', 'none'] as const;
export type RowBarMode = (typeof ROW_BAR_MODES)[number];

const DEFAULT_ROW_BARS: RowBarMode = 'combined';

const isRowBarMode = (value: string): value is RowBarMode => (ROW_BAR_MODES as readonly string[]).includes(value);

// useLocalStorage catches storage errors, so blocked storage keeps the options in memory for the session.
export const useGridDisplayOptions = () => {
  const storedRowBars = useLocalStorage<string>('budget-plan:row-bars', DEFAULT_ROW_BARS);

  const rowBars = computed<RowBarMode>({
    get: () => (isRowBarMode(storedRowBars.value) ? storedRowBars.value : DEFAULT_ROW_BARS),
    set: (value) => {
      storedRowBars.value = value;
    },
  });

  return { rowBars };
};
