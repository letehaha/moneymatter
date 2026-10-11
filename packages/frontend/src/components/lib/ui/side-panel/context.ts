import type { InjectionKey } from 'vue';

export type SidePanelVariant = 'list' | 'cards';

export const SIDE_PANEL_VARIANT: InjectionKey<SidePanelVariant> = Symbol('side-panel-variant');
