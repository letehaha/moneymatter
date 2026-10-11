import { type MaybeRefOrGetter, computed, ref, toValue } from 'vue';

/** `orderedIds` is the visible row order, used to resolve shift-click ranges. */
export const useLineSelection = ({ orderedIds }: { orderedIds: MaybeRefOrGetter<string[]> }) => {
  const selected = ref(new Set<string>());
  const anchorId = ref<string | null>(null);

  const selectedIds = computed(() => toValue(orderedIds).filter((id) => selected.value.has(id)));
  const count = computed(() => selectedIds.value.length);

  const clear = () => {
    selected.value = new Set();
    anchorId.value = null;
  };

  /** Row click: the line becomes the only selection, or clears it when it already was. */
  const select = ({ lineId }: { lineId: string }) => {
    const alreadyOnlyOne = selected.value.size === 1 && selected.value.has(lineId);
    selected.value = alreadyOnlyOne ? new Set() : new Set([lineId]);
    anchorId.value = alreadyOnlyOne ? null : lineId;
  };

  /** Checkbox click: toggles the line, or adds the range from the last anchor when `range` is set. */
  const toggle = ({ lineId, range = false }: { lineId: string; range?: boolean }) => {
    const next = new Set(selected.value);
    const ids = toValue(orderedIds);
    const from = ids.indexOf(anchorId.value ?? '');
    const to = ids.indexOf(lineId);
    if (range && from >= 0 && to >= 0) {
      for (const id of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(id);
    } else if (next.has(lineId)) {
      next.delete(lineId);
    } else {
      next.add(lineId);
    }
    selected.value = next;
    anchorId.value = lineId;
  };

  /** Group or select-all checkbox: deselects when every id is selected, otherwise selects them all. */
  const toggleMany = ({ lineIds }: { lineIds: string[] }) => {
    const next = new Set(selected.value);
    const allSelected = lineIds.length > 0 && lineIds.every((id) => next.has(id));
    for (const id of lineIds) {
      if (allSelected) next.delete(id);
      else next.add(id);
    }
    selected.value = next;
  };

  const stateOf = ({ lineIds }: { lineIds: string[] }): boolean | 'indeterminate' => {
    const hits = lineIds.filter((id) => selected.value.has(id)).length;
    if (hits === 0) return false;
    return hits === lineIds.length ? true : 'indeterminate';
  };

  return { selectedIds, count, select, toggle, toggleMany, stateOf, clear };
};
