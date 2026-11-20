import { tryOnScopeDispose, useLocalStorage } from '@vueuse/core';
import { type MaybeRefOrGetter, computed, readonly, ref, toValue } from 'vue';

/** Bounds shared by the settings and analytics navigation panels. */
export const SUB_NAV_WIDTH = { minWidth: 140, maxWidth: 360, defaultWidth: 208 } as const;

/**
 * Drag-to-resize width persisted in localStorage. `edge` is the side the handle sits on:
 * dragging a left-edge handle leftwards widens the element. `maxWidth` wins over `minWidth`
 * when a dynamic max drops below the min.
 */
export const useResizableWidth = ({
  storageKey,
  minWidth,
  maxWidth,
  defaultWidth,
  edge,
}: {
  storageKey: string;
  minWidth: number;
  maxWidth: MaybeRefOrGetter<number>;
  defaultWidth: number;
  edge: 'left' | 'right';
}) => {
  // useLocalStorage catches storage errors, so blocked storage keeps the width in memory for the session.
  const storedWidth = useLocalStorage(storageKey, defaultWidth);
  const isResizing = ref(false);
  let stopDrag: (() => void) | undefined;

  const clampWidth = ({ width }: { width: number }) =>
    Math.max(0, Math.min(toValue(maxWidth), Math.max(minWidth, Math.round(width))));

  const width = computed(() =>
    clampWidth({ width: Number.isFinite(storedWidth.value) ? storedWidth.value : defaultWidth }),
  );

  // Listeners live on window so the drag still ends if the handle unmounts mid-drag.
  const startResize = (event: PointerEvent) => {
    if (stopDrag) return;
    const handle = event.currentTarget as HTMLElement;
    const startX = event.clientX;
    const startWidth = width.value;
    const direction = edge === 'left' ? -1 : 1;
    handle.setPointerCapture(event.pointerId);
    isResizing.value = true;

    const controller = new AbortController();
    stopDrag = () => {
      controller.abort();
      stopDrag = undefined;
      isResizing.value = false;
    };
    const onMove = (move: PointerEvent) => {
      storedWidth.value = clampWidth({ width: startWidth + (move.clientX - startX) * direction });
    };
    window.addEventListener('pointermove', onMove, { signal: controller.signal });
    window.addEventListener('pointerup', stopDrag, { signal: controller.signal });
    window.addEventListener('pointercancel', stopDrag, { signal: controller.signal });
  };

  const resetWidth = () => {
    storedWidth.value = defaultWidth;
  };

  tryOnScopeDispose(() => stopDrag?.());

  return { width, isResizing: readonly(isResizing), startResize, resetWidth };
};
