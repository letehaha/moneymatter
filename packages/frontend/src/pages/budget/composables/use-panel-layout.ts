import { useResizableWidth } from '@/composable/use-resizable-width';
import { useElementSize, useLocalStorage } from '@vueuse/core';
import { type MaybeRefOrGetter, type Ref, computed, toValue } from 'vue';

const PANEL_MIN_WIDTH = 280;
const PANEL_MAX_WIDTH = 480;
const PANEL_DEFAULT_WIDTH = 330;

export const usePanelLayout = ({ maxWidth }: { maxWidth: MaybeRefOrGetter<number> }) => {
  const panelOpen = useLocalStorage('budget-plan:panel-open', true);
  const {
    width: panelWidth,
    startResize,
    resetWidth: resetPanelWidth,
  } = useResizableWidth({
    storageKey: 'budget-plan:panel-width',
    minWidth: PANEL_MIN_WIDTH,
    maxWidth: () => Math.min(PANEL_MAX_WIDTH, toValue(maxWidth)),
    defaultWidth: PANEL_DEFAULT_WIDTH,
    edge: 'left',
  });

  return { panelWidth, panelOpen, startResize, resetPanelWidth };
};

// Tailwind's @5xl and @2xl container steps: the panel sits beside the lines, floats over them, or opens as a drawer.
const PANEL_ATTACHED_MIN_WIDTH = 1024;
const LINES_TABLE_MIN_WIDTH = 672;
const FLOATING_PANEL_INSET = 20;

export const useFrameLayout = ({ frameRef }: { frameRef: Ref<HTMLElement | null> }) => {
  const { width: frameWidth } = useElementSize(frameRef, { width: PANEL_ATTACHED_MIN_WIDTH, height: 0 });
  const isWide = computed(() => frameWidth.value >= PANEL_ATTACHED_MIN_WIDTH);
  const isNarrow = computed(() => frameWidth.value < LINES_TABLE_MIN_WIDTH);
  // The attached panel never squeezes the table below the width it needs; the floating one only stays inside the frame.
  const panel = usePanelLayout({
    maxWidth: () => (isWide.value ? frameWidth.value - LINES_TABLE_MIN_WIDTH : frameWidth.value - FLOATING_PANEL_INSET),
  });

  return {
    ...panel,
    isNarrow,
    isPanelAttached: computed(() => isWide.value && panel.panelOpen.value),
    isPanelFloating: computed(() => !isWide.value && !isNarrow.value && panel.panelOpen.value),
    isPanelTab: computed(() => !isWide.value && !isNarrow.value && !panel.panelOpen.value),
  };
};
