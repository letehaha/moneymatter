import { useLocalStorage } from '@vueuse/core';

const PANEL_SECTIONS = ['breakdown', 'coverage', 'goals', 'scheduled', 'trend', 'pace', 'goal'] as const;

export type PanelSection = (typeof PANEL_SECTIONS)[number];

// The mobile drawer keeps its own state, so sections collapsed on desktop still start open there.
export const usePanelSections = ({ drawer }: { drawer?: boolean } = {}) =>
  useLocalStorage<Record<PanelSection, boolean>>(
    drawer ? 'budget-plan:drawer-open-sections' : 'budget-plan:panel-open-sections',
    Object.fromEntries(PANEL_SECTIONS.map((section) => [section, true])) as Record<PanelSection, boolean>,
    { mergeDefaults: true },
  );
