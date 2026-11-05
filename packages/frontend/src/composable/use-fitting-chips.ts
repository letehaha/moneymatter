import { useResizeObserver } from '@vueuse/core';
import { type ComponentPublicInstance, type MaybeRefOrGetter, computed, ref, toValue, watch } from 'vue';

/**
 * Counts chips past the first line of their list, for a "+N". The list must wrap, be clipped to one
 * chip's height and have a bounded width; its direct children are the chips.
 */
export function useFittingChips({ items }: { items: MaybeRefOrGetter<readonly unknown[]> }) {
  const listEl = ref<HTMLElement | null>(null);
  const visibleCount = ref(toValue(items).length);

  function measure() {
    const chips = Array.from(listEl.value?.children ?? []).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );
    const [first] = chips;
    if (!first) return;
    visibleCount.value = chips.filter((chip) => chip.offsetTop === first.offsetTop).length;
  }

  useResizeObserver(listEl, measure);
  watch(() => toValue(items), measure, { flush: 'post' });

  const setListRef = (el: Element | ComponentPublicInstance | null) => {
    listEl.value = el instanceof HTMLElement ? el : null;
  };
  const hiddenCount = computed(() => Math.max(0, toValue(items).length - visibleCount.value));

  return { setListRef, hiddenCount };
}
