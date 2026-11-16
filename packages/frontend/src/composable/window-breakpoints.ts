import { refDebounced, useWindowSize } from '@vueuse/core';
import { ComputedRef, computed } from 'vue';

interface Options {
  wait?: number; // Debounce wait time (default: 300ms)
  direction?: 'up' | 'down'; // "down" for <=, "up" for >= (default: "down")
}

export const CUSTOM_BREAKPOINTS = Object.freeze({
  uiMobile: 767,
  uiDesktop: 1024,
});

type Breakpoint = number | (typeof CUSTOM_BREAKPOINTS)[keyof typeof CUSTOM_BREAKPOINTS];

export function useWindowBreakpoints(size: Breakpoint, options?: Options): ComputedRef<boolean>;
export function useWindowBreakpoints(size: Breakpoint[], options?: Options): ComputedRef<boolean[]>;

export function useWindowBreakpoints(
  size: Breakpoint | Breakpoint[],
  options: Options = {},
): ComputedRef<boolean | boolean[]> {
  const { wait = 300, direction = 'down' } = options;
  const { width: windowWidth } = useWindowSize();
  const debouncedWindowWidth = refDebounced(windowWidth, wait);

  const isExpectedSize = computed(() => {
    if (Array.isArray(size)) {
      return size.map((breakpoint) =>
        direction === 'down' ? debouncedWindowWidth.value <= breakpoint : debouncedWindowWidth.value >= breakpoint,
      );
    }

    return direction === 'down' ? debouncedWindowWidth.value <= size : debouncedWindowWidth.value >= size;
  });

  return isExpectedSize;
}
