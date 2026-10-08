import { useUserSettings } from '@/composable/data-queries/user-settings';
import type { SidebarSectionsConfig } from '@bt/shared/types';
import { CarIcon, HandCoinsIcon, RocketIcon, TrendingUpIcon } from '@lucide/vue';
import { type Component, computed } from 'vue';

type SidebarSectionKey = keyof SidebarSectionsConfig;

interface ToggleableSidebarSection {
  key: SidebarSectionKey;
  labelKey: string;
  icon: Component;
}

/**
 * Label + icon for every optional sidebar section, keyed by its config key. Typing it as a
 * `Record<SidebarSectionKey, …>` keeps it exhaustive: adding a key to `SidebarSectionsConfig`
 * fails to compile here until its label and icon are supplied, so a new section can't silently
 * go missing from the toggle UIs. Bank Accounts is always visible, so it is intentionally not a
 * `SidebarSectionKey` and is rendered separately as a disabled, always-on row.
 */
const SIDEBAR_SECTION_META: Record<SidebarSectionKey, { labelKey: string; icon: Component }> = {
  portfolios: { labelKey: 'sidebar.accountsView.portfolios', icon: TrendingUpIcon },
  ventures: { labelKey: 'sidebar.accountsView.ventures', icon: RocketIcon },
  vehicles: { labelKey: 'sidebar.accountsView.cars', icon: CarIcon },
  loans: { labelKey: 'sidebar.accountsView.loans', icon: HandCoinsIcon },
};

/** Ordered list the toggle UIs iterate; order follows `SIDEBAR_SECTION_META`. */
export const TOGGLEABLE_SIDEBAR_SECTIONS: ToggleableSidebarSection[] = (
  Object.keys(SIDEBAR_SECTION_META) as SidebarSectionKey[]
).map((key) => ({ key, ...SIDEBAR_SECTION_META[key] }));

/**
 * Shared read/write access to the sidebar-section visibility preferences. Used
 * by both the sidebar's quick-settings popover and the appearance settings
 * page so the two stay in sync. A toggle is written as a partial patch so it
 * never clobbers the other sections' values.
 */
export const useSidebarSections = () => {
  const { data: userSettings, patchAsync, isPatching } = useUserSettings();

  const sidebarSections = computed<SidebarSectionsConfig>(() => ({
    portfolios: userSettings.value?.sidebarSections?.portfolios ?? true,
    ventures: userSettings.value?.sidebarSections?.ventures ?? true,
    vehicles: userSettings.value?.sidebarSections?.vehicles ?? true,
    loans: userSettings.value?.sidebarSections?.loans ?? true,
  }));

  const toggleSection = (key: SidebarSectionKey, value: boolean) => {
    const patch: Partial<SidebarSectionsConfig> = { [key]: value };
    return patchAsync({ sidebarSections: patch });
  };

  return { sidebarSections, toggleSection, isUpdating: isPatching };
};
