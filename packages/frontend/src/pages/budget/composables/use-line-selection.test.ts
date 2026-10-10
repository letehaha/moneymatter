import { useLineSelection } from './use-line-selection';

describe('useLineSelection', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];

  it('row click selects one line and clicking it again clears', () => {
    const selection = useLineSelection({ orderedIds: ids });
    selection.select({ lineId: 'b' });
    expect(selection.selectedIds.value).toEqual(['b']);
    selection.select({ lineId: 'd' });
    expect(selection.selectedIds.value).toEqual(['d']);
    selection.select({ lineId: 'd' });
    expect(selection.count.value).toBe(0);
  });

  it('checkbox toggles accumulate and shift-click adds the range from the anchor', () => {
    const selection = useLineSelection({ orderedIds: ids });
    selection.toggle({ lineId: 'a' });
    selection.toggle({ lineId: 'd', range: true });
    expect(selection.selectedIds.value).toEqual(['a', 'b', 'c', 'd']);
    selection.toggle({ lineId: 'b' });
    expect(selection.selectedIds.value).toEqual(['a', 'c', 'd']);
    selection.toggle({ lineId: 'e', range: true });
    expect(selection.selectedIds.value).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('group toggle selects all, reports indeterminate, then deselects all', () => {
    const selection = useLineSelection({ orderedIds: ids });
    selection.toggleMany({ lineIds: ['a', 'b'] });
    expect(selection.stateOf({ lineIds: ['a', 'b'] })).toBe(true);
    expect(selection.stateOf({ lineIds: ids })).toBe('indeterminate');
    selection.toggleMany({ lineIds: ['a', 'b'] });
    expect(selection.stateOf({ lineIds: ['a', 'b'] })).toBe(false);
    expect(selection.stateOf({ lineIds: [] })).toBe(false);
  });

  it('ignores ids that are no longer visible when ordering the selection', () => {
    const selection = useLineSelection({ orderedIds: () => ['c', 'a'] });
    selection.toggle({ lineId: 'a' });
    selection.toggle({ lineId: 'z' });
    expect(selection.selectedIds.value).toEqual(['a']);
    selection.clear();
    expect(selection.count.value).toBe(0);
  });
});
