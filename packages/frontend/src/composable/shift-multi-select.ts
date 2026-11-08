import { useEventListener } from '@vueuse/core';
import { ref } from 'vue';

/**
 * Composable for handling shift-click multi-selection functionality
 * @param selectedItems Set containing selected item IDs
 * @param onUpdate Optional callback to trigger reactivity updates
 * @returns Functions and state for managing multi-selection
 */
export function useShiftMultiSelect<K>(selectedItems: Set<K>, onUpdate?: () => void) {
  // Track if shift key is pressed
  const isShiftKeyPressed = ref(false);

  // Track last clicked index
  let lastClickedIndex: number | null = null;

  useEventListener(window, 'keydown', (e: KeyboardEvent) => {
    if (e.key === 'Shift') {
      isShiftKeyPressed.value = true;
    }
  });

  useEventListener(window, 'keyup', (e: KeyboardEvent) => {
    if (e.key === 'Shift') {
      isShiftKeyPressed.value = false;
    }
  });

  // The Shift keyup never arrives when focus leaves the window mid-press (e.g. the Cmd+Shift+4 screenshot shortcut).
  useEventListener(window, 'blur', () => {
    isShiftKeyPressed.value = false;
  });
  useEventListener(window, 'pointerdown', (e: PointerEvent) => (isShiftKeyPressed.value = e.shiftKey), {
    capture: true,
  });

  /**
   * Handle item selection with shift-click support
   * @param value Whether the item is being selected or deselected
   * @param id The ID of the item being toggled
   * @param index The index of the item in the list
   * @param items The full array of items
   * @param getItemId Function to extract the ID from an item
   */
  const handleSelection = <I>(value: boolean, id: K, index: number, items: I[], getItemId: (item: I) => K) => {
    // Handle single item selection
    if (value) {
      selectedItems.add(id);
    } else {
      selectedItems.delete(id);
    }

    // Handle shift+click multi-selection
    if (isShiftKeyPressed.value && lastClickedIndex !== null && index !== lastClickedIndex) {
      const start = Math.min(lastClickedIndex, index);
      const end = Math.max(lastClickedIndex, index);

      // Apply the same selection state to all items in range
      for (let i = start; i <= end; i++) {
        const item = items[i];
        if (item) {
          const itemId = getItemId(item);
          if (value) {
            selectedItems.add(itemId);
          } else {
            selectedItems.delete(itemId);
          }
        }
      }
    }

    // Update last clicked index
    lastClickedIndex = index;

    // Trigger reactivity update
    onUpdate?.();
  };

  /**
   * Reset selection state
   */
  const resetSelection = () => {
    selectedItems.clear();
    lastClickedIndex = null;
    onUpdate?.();
  };

  return {
    isShiftKeyPressed,
    handleSelection,
    resetSelection,
  };
}
