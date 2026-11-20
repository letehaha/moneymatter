import { describe, expect, it } from 'vitest';

import { useShiftMultiSelect } from './shift-multi-select';

const items = [1, 2, 3, 4, 5, 6, 7];

describe('useShiftMultiSelect', () => {
  it('selects a single row when the Shift keyup was lost to a window blur', () => {
    const selected = new Set<number>();
    const { handleSelection } = useShiftMultiSelect(selected);

    handleSelection(true, 2, 1, items, (item) => item);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
    window.dispatchEvent(new Event('blur'));
    handleSelection(true, 7, 6, items, (item) => item);

    expect([...selected]).toEqual([2, 7]);
  });

  it('reads Shift from the click itself, not the tracked key state', () => {
    const selected = new Set<number>();
    const { handleSelection } = useShiftMultiSelect(selected);

    handleSelection(true, 2, 1, items, (item) => item);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
    window.dispatchEvent(new MouseEvent('pointerdown', { shiftKey: false }));
    handleSelection(true, 7, 6, items, (item) => item);
    expect([...selected]).toEqual([2, 7]);

    window.dispatchEvent(new MouseEvent('pointerdown', { shiftKey: true }));
    handleSelection(true, 4, 3, items, (item) => item);
    expect([...selected].sort()).toEqual([2, 4, 5, 6, 7]);
  });
});
