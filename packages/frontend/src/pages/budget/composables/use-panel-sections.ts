import { useSidePanelSections } from '@/components/lib/ui/side-panel';

export type PanelSection =
  | 'breakdown'
  | 'coverage'
  | 'goals'
  | 'scheduled'
  | 'budgetingTrend'
  | 'spendingTrend'
  | 'pace'
  | 'goal';

export const usePanelSections = () =>
  useSidePanelSections<PanelSection>({
    storageKey: 'budget-plan:panel-open-sections',
    defaults: {
      breakdown: true,
      coverage: true,
      goals: true,
      scheduled: true,
      budgetingTrend: true,
      spendingTrend: true,
      pace: true,
      goal: true,
    },
  });
