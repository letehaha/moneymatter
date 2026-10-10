import { useLocalStorage } from '@vueuse/core';
import { type MaybeRefOrGetter, computed, toValue } from 'vue';

export const PANEL_MIN_WIDTH = 280;
export const PANEL_MAX_WIDTH = 480;
const PANEL_DEFAULT_WIDTH = 330;

// useLocalStorage catches storage errors, so blocked storage keeps the layout in memory for the session.
export const usePanelLayout = ({ maxWidth }: { maxWidth: MaybeRefOrGetter<number> }) => {
  const storedWidth = useLocalStorage('budget-plan:panel-width', PANEL_DEFAULT_WIDTH);
  const panelOpen = useLocalStorage('budget-plan:panel-open', true);

  const clampWidth = (width: number) =>
    Math.min(PANEL_MAX_WIDTH, toValue(maxWidth), Math.max(PANEL_MIN_WIDTH, Math.round(width)));

  const panelWidth = computed(() =>
    clampWidth(Number.isFinite(storedWidth.value) ? storedWidth.value : PANEL_DEFAULT_WIDTH),
  );

  /** Drag handle on the panel's left edge: moving left widens the panel. */
  const startResize = (event: PointerEvent) => {
    const handle = event.currentTarget as HTMLElement;
    const startX = event.clientX;
    const startWidth = panelWidth.value;
    handle.setPointerCapture(event.pointerId);
    const onMove = (move: PointerEvent) => {
      storedWidth.value = clampWidth(startWidth + startX - move.clientX);
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
