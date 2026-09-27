import { useLocalStorage } from '@vueuse/core';

export { Collapsible as SidePanelSection } from '@/components/lib/ui/collapsible';
export { default as SidePanel } from './side-panel.vue';
export { default as SidePanelSectionContent } from './side-panel-section-content.vue';
export { default as SidePanelSectionSkeleton } from './side-panel-section-skeleton.vue';
export { default as SidePanelSectionTrigger } from './side-panel-section-trigger.vue';
export { default as SidePanelSections } from './side-panel-sections.vue';

export const useSidePanelSections = <K extends string>({
  storageKey,
  defaults,
}: {
  storageKey: string;
  defaults: Record<K, boolean>;
}) => useLocalStorage<Record<K, boolean>>(storageKey, defaults, { mergeDefaults: true });
