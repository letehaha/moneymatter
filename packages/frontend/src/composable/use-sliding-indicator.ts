import { useMutationObserver, useResizeObserver } from '@vueuse/core';
import { type Ref, computed, onScopeDispose, ref, watch } from 'vue';

const SLIDE_MS = 200;
const INDICATOR_ATTR = 'data-sliding-indicator';
/** The pill's look, for elements that show the same active state without sliding. */
export const SLIDING_PILL_SURFACE =
  'border-border bg-card dark:border-input dark:bg-secondary shadow-sm dark:shadow-none';
const SIDES = ['top', 'left', 'width', 'height'] as const;

interface IndicatorRect {
  top: string;
  left: string;
  width: string;
  height: string;
}

/**
 * Keeps one absolute pill over the `activeSelector` element of `containerRef` (its offset parent).
 * It slides only when `activeKey` changes; geometry changes apply instantly. Element identity
 * can't replace the key: a toggling wrapper re-mounts the link.
 * The slide is a transform animation, so it runs on the compositor and stays smooth while a
 * route change mounts the next page on the main thread.
 */
export function useSlidingIndicator({
  containerRef,
  activeSelector,
  activeKey,
}: {
  containerRef: Ref<HTMLElement | null | undefined>;
  activeSelector: string;
  activeKey: () => unknown;
}) {
  const rect = ref<IndicatorRect | null>(null);
  const isActiveMissing = ref(false);
  let placedKey: unknown;
  let slide: Animation | undefined;
  let forgetTimer: ReturnType<typeof setTimeout> | undefined;

  const forget = () => {
    clearTimeout(forgetTimer);
    forgetTimer = undefined;
    isActiveMissing.value = false;
    rect.value = null;
  };

  const slideTo = ({ container, target }: { container: HTMLElement; target: DOMRect }) => {
    const pill = container.querySelector<HTMLElement>(`[${INDICATOR_ATTR}]`);
    if (!pill?.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    // Read before cancelling, so a slide interrupted mid-flight continues from where it is on screen.
    const from = pill.getBoundingClientRect();
    slide?.cancel();
    if (!from.width || !from.height || !target.width || !target.height) return;
    const isInPlace = SIDES.every((side) => Math.abs(from[side] - target[side]) < 0.5);
    if (isInPlace) return;
    const offset = `translate(${from.left - target.left}px, ${from.top - target.top}px)`;
    const scale = `scale(${from.width / target.width}, ${from.height / target.height})`;
    slide = pill.animate([{ transform: `${offset} ${scale}` }, { transform: 'none' }], {
      duration: SLIDE_MS,
      easing: 'ease-out',
    });
  };

  const update = () => {
    const container = containerRef.value;
    if (!container) {
      forget();
      return;
    }
    const el = container.querySelector<HTMLElement>(activeSelector);
    // A route change can leave no item active for a tick (a section still mounting, a redirect
    // in flight). The last position survives that gap so the pill slides on from it.
    if (!el) {
      if (rect.value && !isActiveMissing.value) {
        isActiveMissing.value = true;
        forgetTimer = setTimeout(forget, SLIDE_MS);
      }
      return;
    }
    clearTimeout(forgetTimer);
    forgetTimer = undefined;
    isActiveMissing.value = false;

    const key = activeKey();
    const target = el.getBoundingClientRect();
    if (rect.value && key !== placedKey) slideTo({ container, target });
    placedKey = key;

    const box = container.getBoundingClientRect();
    const next: IndicatorRect = {
      top: `${target.top - box.top - container.clientTop + container.scrollTop}px`,
      left: `${target.left - box.left - container.clientLeft + container.scrollLeft}px`,
      width: `${target.width}px`,
      height: `${target.height}px`,
    };
    const prev = rect.value;
    if (!prev || SIDES.some((side) => prev[side] !== next[side])) {
      rect.value = next;
    }
  };

  watch(containerRef, update, { flush: 'post', immediate: true });
  watch(activeKey, update, { flush: 'post' });
  useResizeObserver(containerRef, update);
  useMutationObserver(containerRef, update, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  onScopeDispose(() => {
    slide?.cancel();
    clearTimeout(forgetTimer);
  });

  /** Spread onto the pill element with `v-bind`. */
  const indicator = computed(() => ({
    'aria-hidden': true,
    [INDICATOR_ATTR]: '',
    style: rect.value ?? undefined,
    class: [
      'pointer-events-none absolute -z-1 origin-top-left',
      'rounded-md border',
      SLIDING_PILL_SURFACE,
      !rect.value && 'hidden',
      isActiveMissing.value && 'opacity-0',
    ],
  }));

  return { indicator };
}
