import { useLocalStorage } from '@vueuse/core';

export const PANEL_SECTION_TITLES = {
  breakdown: 'budgetPlans.panel.breakdown',
  note: 'budgetPlans.panel.note.label',
  transactions: 'budgetPlans.panel.lineTransactions.title',
  coverage: 'budgetPlans.panel.nextPeriodCoverage',
  scheduled: 'budgetPlans.panel.scheduled',
  trend: 'budgetPlans.panel.trend.title',
  averages: 'budgetPlans.panel.averages.title',
  pace: 'budgetPlans.panel.pace',
  goals: 'budgetPlans.panel.goals',
  goal: 'budgetPlans.panel.goal',
} as const;

export type PanelSection = keyof typeof PANEL_SECTION_TITLES;

const PANEL_SECTIONS = Object.keys(PANEL_SECTION_TITLES) as PanelSection[];

// The mobile drawer keeps its own state, so sections collapsed on desktop still start open there.
export const usePanelSections = ({ drawer }: { drawer?: boolean } = {}) =>
  useLocalStorage<Record<PanelSection, boolean>>(
    drawer ? 'budget-plan:drawer-open-sections' : 'budget-plan:panel-open-sections',
    Object.fromEntries(PANEL_SECTIONS.map((section) => [section, true])) as Record<PanelSection, boolean>,
    { mergeDefaults: true },
  );

type PanelSectionLayout = { order: PanelSection[]; hidden: PanelSection[] };

export const defaultPanelSectionLayout = (): PanelSectionLayout => ({ order: [...PANEL_SECTIONS], hidden: [] });

const knownSections = (value: unknown): PanelSection[] =>
  Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (key): key is PanelSection => typeof key === 'string' && Object.hasOwn(PANEL_SECTION_TITLES, key),
          ),
        ),
      ]
    : [];

/** Stored layout with unknown or repeated keys dropped and sections added since it was saved appended. */
export const sanitizePanelSectionLayout = (stored: unknown): PanelSectionLayout => {
  const { order, hidden } = (stored ?? {}) as Partial<Record<keyof PanelSectionLayout, unknown>>;
  const known = knownSections(order);
  return {
    order: [...known, ...PANEL_SECTIONS.filter((key) => !known.includes(key))],
    hidden: knownSections(hidden),
  };
};

export const usePanelSectionLayout = () =>
  useLocalStorage<PanelSectionLayout>('budget-plan:panel-layout', defaultPanelSectionLayout(), {
    mergeDefaults: sanitizePanelSectionLayout,
  });
