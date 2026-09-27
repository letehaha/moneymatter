import { useSidePanelSections } from '@/components/lib/ui/side-panel';
import { createSharedComposable } from '@vueuse/core';

export type AssumptionSection = 'spending' | 'contribution' | 'counts' | 'return' | 'withdrawal' | 'more';

export const useAssumptionSections = createSharedComposable(() => ({
  openSections: useSidePanelSections<AssumptionSection>({
    storageKey: 'fire:assumptions-open-sections',
    defaults: { spending: true, contribution: true, counts: true, return: true, withdrawal: true, more: false },
  }),
}));
