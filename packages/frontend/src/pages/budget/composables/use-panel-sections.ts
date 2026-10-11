import { useLocalStorage } from '@vueuse/core';

const PANEL_SECTIONS = [
  'breakdown',
  'coverage',
  'goals',
  'scheduled',
  'budgetingTrend',
  'spendingTrend',
  'pace',
  'goal',
] as const;

export type PanelSection = (typeof PANEL_SECTIONS)[number];

export const usePanelSections = () =>
  useLocalStorage<Record<PanelSection, boolean>>(
    'budget-plan:panel-open-sections',
    Object.fromEntries(PANEL_SECTIONS.map((section) => [section, true])) as Record<PanelSection, boolean>,
    { mergeDefaults: true },
  );
