import { useElementSize, useLocalStorage } from '@vueuse/core';
import { type MaybeRefOrGetter, type Ref, computed, toValue } from 'vue';

const PANEL_MIN_WIDTH = 280;
const PANEL_MAX_WIDTH = 480;
const PANEL_DEFAULT_WIDTH = 330;

// useLocalStorage catches storage errors, so blocked storage keeps the layout in memory for the session.
export const usePanelLayout = ({ maxWidth }: { maxWidth: MaybeRefOrGetter<number> }) => {
  const storedWidth = useLocalStorage('budget-plan:panel-width', PANEL_DEFAULT_WIDTH);
  const panelOpen = useLocalStorage('budget-plan:panel-open', true);

  const clampWidth = ({ width }: { width: number }) =>
    Math.min(PANEL_MAX_WIDTH, toValue(maxWidth), Math.max(PANEL_MIN_WIDTH, Math.round(width)));

  const panelWidth = computed(() =>
    clampWidth({ width: Number.isFinite(storedWidth.value) ? storedWidth.value : PANEL_DEFAULT_WIDTH }),
  );

  /** Drag handle on the panel's left edge: moving left widens the panel. */
  const startResize = (event: PointerEvent) => {
    const handle = event.currentTarget as HTMLElement;
    const startX = event.clientX;
    const startWidth = panelWidth.value;
    handle.setPointerCapture(event.pointerId);
    const onMove = (move: PointerEvent) => {
      storedWidth.value = clampWidth({ width: startWidth + startX - move.clientX });
    };
    const onEnd = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  };

  return { panelWidth, panelOpen, startResize };
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
