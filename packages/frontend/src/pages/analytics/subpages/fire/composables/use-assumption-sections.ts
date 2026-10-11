import { createSharedComposable, useLocalStorage } from '@vueuse/core';

export type AssumptionSection = 'spending' | 'contribution' | 'counts' | 'return' | 'withdrawal' | 'more';

export const useAssumptionSections = createSharedComposable(() => ({
  openSections: useLocalStorage<Record<AssumptionSection, boolean>>(
    'fire:assumptions-open-sections',
    { spending: true, contribution: true, counts: true, return: true, withdrawal: true, more: false },
    { mergeDefaults: true },
  ),
}));
