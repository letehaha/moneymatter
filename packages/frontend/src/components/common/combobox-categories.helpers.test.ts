import { type FormattedCategory } from '@/common/types';
import { type RecordId } from '@bt/shared/types';
import { CATEGORY_TYPES } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import {
  type FlatCategory,
  collectDescendantIds,
  computeCheckedState,
  computeSessionRootOrder,
  flattenCategories,
  sortInternalLast,
  toggleCategorySelection,
} from './combobox-categories.helpers';

const makeCategory = (overrides: Partial<FormattedCategory> & { id: RecordId; name: string }): FormattedCategory => ({
  id: overrides.id,
  key: overrides.key ?? null,
  name: overrides.name,
  color: '#000',
  icon: null,
  parentId: overrides.parentId ?? null,
  type: overrides.type ?? CATEGORY_TYPES.custom,
  userId: 1,
  defaultTagIds: [],
  applyDefaultTagsOnAiCategorization: false,
  subCategories: overrides.subCategories ?? [],
});

// Tree:
// Food ('1')
//   ├─ Groceries ('2')
//   └─ Restaurants ('3')
//        ├─ Fast Food ('4')
//        └─ Fine Dining ('5')
// Transport ('10')
//   ├─ Gas ('11')
//   └─ Public ('12')
// [internal] Transfers ('100')
const buildTree = (): FormattedCategory[] => {
  const fastFood = makeCategory({ id: '4' as RecordId, name: 'Fast Food', parentId: '3' as RecordId });
  const fineDining = makeCategory({ id: '5' as RecordId, name: 'Fine Dining', parentId: '3' as RecordId });
  const groceries = makeCategory({ id: '2' as RecordId, name: 'Groceries', parentId: '1' as RecordId });
  const restaurants = makeCategory({
    id: '3' as RecordId,
    name: 'Restaurants',
    parentId: '1' as RecordId,
    subCategories: [fastFood, fineDining],
  });
  const food = makeCategory({ id: '1' as RecordId, name: 'Food', subCategories: [groceries, restaurants] });

  const gas = makeCategory({ id: '11' as RecordId, name: 'Gas', parentId: '10' as RecordId });
  const publicTransport = makeCategory({ id: '12' as RecordId, name: 'Public', parentId: '10' as RecordId });
  const transport = makeCategory({ id: '10' as RecordId, name: 'Transport', subCategories: [gas, publicTransport] });

  const transfers = makeCategory({ id: '100' as RecordId, name: 'Transfers', type: CATEGORY_TYPES.internal });

  return [food, transport, transfers];
};

const flatTree = (): FlatCategory[] => flattenCategories({ categories: sortInternalLast({ roots: buildTree() }) });

const findFlat = (items: FlatCategory[], id: string): FlatCategory => {
  const found = items.find((i) => i.id === id);
  if (!found) throw new Error(`Fixture missing id ${id}`);
  return found;
};

describe('collectDescendantIds', () => {
  it('returns ids of all nested descendants in depth-first order', () => {
    const [food] = buildTree();
    expect(collectDescendantIds({ category: food! })).toEqual(['2', '3', '4', '5']);
  });

  it('returns empty array for leaf categories', () => {
    const leaf = makeCategory({ id: '99' as RecordId, name: 'Leaf' });
    expect(collectDescendantIds({ category: leaf })).toEqual([]);
  });
});

describe('sortInternalLast', () => {
  it('moves internal categories to the end while preserving other order', () => {
    const sorted = sortInternalLast({ roots: buildTree() });
    expect(sorted.map((c) => c.id)).toEqual(['1', '10', '100']);
  });

  it('does not mutate the input array', () => {
    const roots = buildTree();
    const originalOrder = roots.map((c) => c.id);
    sortInternalLast({ roots });
    expect(roots.map((c) => c.id)).toEqual(originalOrder);
  });
});

describe('flattenCategories', () => {
  it('produces a depth-first ordered list with depth and root metadata', () => {
    const flat = flatTree();
    expect(flat.map((c) => [c.id, c.depth, c.rootParentId, c.rootParentName])).toEqual([
      ['1', 0, '1', 'Food'],
      ['2', 1, '1', 'Food'],
      ['3', 1, '1', 'Food'],
      ['4', 2, '1', 'Food'],
      ['5', 2, '1', 'Food'],
      ['10', 0, '10', 'Transport'],
      ['11', 1, '10', 'Transport'],
      ['12', 1, '10', 'Transport'],
      ['100', 0, '100', 'Transfers'],
    ]);
  });

  it('populates descendantIds for each node', () => {
    const flat = flatTree();
    expect(findFlat(flat, '1').descendantIds).toEqual(['2', '3', '4', '5']);
    expect(findFlat(flat, '3').descendantIds).toEqual(['4', '5']);
    expect(findFlat(flat, '2').descendantIds).toEqual([]);
  });

  it('returns an empty list for an empty input', () => {
    expect(flattenCategories({ categories: [] })).toEqual([]);
  });

  it('propagates the original root parent to grandchildren beyond depth 2', () => {
    // Food ('1') > Restaurants ('3') > Fast Food ('4') > Bao Place ('200')
    const baoPlace = makeCategory({ id: '200' as RecordId, name: 'Bao Place', parentId: '4' as RecordId });
    const fastFood = makeCategory({
      id: '4' as RecordId,
      name: 'Fast Food',
      parentId: '3' as RecordId,
      subCategories: [baoPlace],
    });
    const restaurants = makeCategory({
      id: '3' as RecordId,
      name: 'Restaurants',
      parentId: '1' as RecordId,
      subCategories: [fastFood],
    });
    const food = makeCategory({ id: '1' as RecordId, name: 'Food', subCategories: [restaurants] });

    const flat = flattenCategories({ categories: [food] });
    const grandchild = findFlat(flat, '200');
    expect(grandchild.depth).toBe(3);
    expect(grandchild.rootParentId).toBe('1');
    expect(grandchild.rootParentName).toBe('Food');
  });
});

describe('computeCheckedState', () => {
  const flat = flatTree();

  it('returns true when a leaf is selected', () => {
    expect(computeCheckedState({ item: findFlat(flat, '2'), selectedIds: new Set(['2']), isSearching: false })).toBe(
      true,
    );
  });

  it('returns false when a leaf is not selected', () => {
    expect(computeCheckedState({ item: findFlat(flat, '2'), selectedIds: new Set([]), isSearching: false })).toBe(
      false,
    );
  });

  it('returns true for a parent when the parent and all descendants are selected', () => {
    expect(
      computeCheckedState({
        item: findFlat(flat, '1'),
        selectedIds: new Set(['1', '2', '3', '4', '5']),
        isSearching: false,
      }),
    ).toBe(true);
  });

  it('returns indeterminate when only some descendants are selected', () => {
    expect(
      computeCheckedState({
        item: findFlat(flat, '1'),
        selectedIds: new Set(['2']),
        isSearching: false,
      }),
    ).toBe('indeterminate');
  });

  it('returns false for a parent with no self or descendant selection', () => {
    expect(
      computeCheckedState({
        item: findFlat(flat, '1'),
        selectedIds: new Set(['11']),
        isSearching: false,
      }),
    ).toBe(false);
  });

  it('returns indeterminate when parent is selected but descendants are only partially selected', () => {
    expect(
      computeCheckedState({
        item: findFlat(flat, '1'),
        selectedIds: new Set(['1', '2']),
        isSearching: false,
      }),
    ).toBe('indeterminate');
  });

  it('ignores descendants when searching — reflects only self', () => {
    expect(
      computeCheckedState({
        item: findFlat(flat, '1'),
        selectedIds: new Set(['2', '3', '4', '5']),
        isSearching: true,
      }),
    ).toBe(false);

    expect(
      computeCheckedState({
        item: findFlat(flat, '1'),
        selectedIds: new Set(['1']),
        isSearching: true,
      }),
    ).toBe(true);
  });

  it('reflects only self in independent mode — never indeterminate from descendants', () => {
    // Descendants selected but not the parent → unchecked (no indeterminate roll-up).
    expect(
      computeCheckedState({
        item: findFlat(flat, '1'),
        selectedIds: new Set(['2', '3']),
        isSearching: false,
        independent: true,
      }),
    ).toBe(false);

    // Parent selected on its own → checked, regardless of descendant selection.
    expect(
      computeCheckedState({
        item: findFlat(flat, '1'),
        selectedIds: new Set(['1']),
        isSearching: false,
        independent: true,
      }),
    ).toBe(true);
  });
});

describe('toggleCategorySelection', () => {
  const flat = flatTree();

  it('selects a leaf and emits its id', () => {
    const next = toggleCategorySelection({
      item: findFlat(flat, '2'),
      clickedIndex: 1,
      currentSelection: [],
      displayedItems: flat,
      isSearching: false,
      isShiftPressed: false,
      lastClickedIndex: null,
    });
    expect(next.sort()).toEqual(['2']);
  });

  it('selects a parent plus all descendants when not searching', () => {
    const next = toggleCategorySelection({
      item: findFlat(flat, '1'),
      clickedIndex: 0,
      currentSelection: [],
      displayedItems: flat,
      isSearching: false,
      isShiftPressed: false,
      lastClickedIndex: null,
    });
    expect(next.sort()).toEqual(['1', '2', '3', '4', '5']);
  });

  it('deselects the parent plus descendants when clicking an already fully-selected parent', () => {
    const next = toggleCategorySelection({
      item: findFlat(flat, '1'),
      clickedIndex: 0,
      currentSelection: ['1', '2', '3', '4', '5', '11'],
      displayedItems: flat,
      isSearching: false,
      isShiftPressed: false,
      lastClickedIndex: null,
    });
    expect(next.sort()).toEqual(['11']);
  });

  it('selects a partially-selected parent and fills in missing descendants', () => {
    const next = toggleCategorySelection({
      item: findFlat(flat, '1'),
      clickedIndex: 0,
      currentSelection: ['2'],
      displayedItems: flat,
      isSearching: false,
      isShiftPressed: false,
      lastClickedIndex: null,
    });
    expect(next.sort()).toEqual(['1', '2', '3', '4', '5']);
  });

  it('fills in descendants when parent is already selected but descendants are missing', () => {
    const next = toggleCategorySelection({
      item: findFlat(flat, '1'),
      clickedIndex: 0,
      currentSelection: ['1'],
      displayedItems: flat,
      isSearching: false,
      isShiftPressed: false,
      lastClickedIndex: null,
    });
    expect(next.sort()).toEqual(['1', '2', '3', '4', '5']);
  });

  it('only toggles the clicked item when searching, even for parents with descendants', () => {
    const next = toggleCategorySelection({
      item: findFlat(flat, '1'),
      clickedIndex: 0,
      currentSelection: [],
      displayedItems: flat,
      isSearching: true,
      isShiftPressed: false,
      lastClickedIndex: null,
    });
    expect(next).toEqual(['1']);
  });

  it('leaves descendants untouched when deselecting a parent in search mode', () => {
    const next = toggleCategorySelection({
      item: findFlat(flat, '1'),
      clickedIndex: 0,
      currentSelection: ['1', '2', '3', '4', '5'],
      displayedItems: flat,
      isSearching: true,
      isShiftPressed: false,
      lastClickedIndex: null,
    });
    expect(next.sort()).toEqual(['2', '3', '4', '5']);
  });

  it('applies shift-click range selection across displayed items', () => {
    const next = toggleCategorySelection({
      item: findFlat(flat, '4'),
      clickedIndex: 3, // Fast Food
      currentSelection: [],
      displayedItems: flat,
      isSearching: false,
      isShiftPressed: true,
      lastClickedIndex: 1, // Groceries
    });
    // Range covers indices 1..3: Groceries('2'), Restaurants('3')+descendants('4','5'), Fast Food('4')
    expect(next.sort()).toEqual(['2', '3', '4', '5']);
  });

  it('ignores shift when lastClickedIndex is null', () => {
    const next = toggleCategorySelection({
      item: findFlat(flat, '2'),
      clickedIndex: 1,
      currentSelection: [],
      displayedItems: flat,
      isSearching: false,
      isShiftPressed: true,
      lastClickedIndex: null,
    });
    expect(next).toEqual(['2']);
  });

  it('only toggles the clicked item when shift-clicking the same index as last click', () => {
    // lastClickedIndex === clickedIndex: range is empty beyond the clicked item
    const next = toggleCategorySelection({
      item: findFlat(flat, '2'),
      clickedIndex: 1,
      currentSelection: [],
      displayedItems: flat,
      isSearching: false,
      isShiftPressed: true,
      lastClickedIndex: 1,
    });
    expect(next).toEqual(['2']);
  });

  it('deselects a range via shift-click when the anchor is already selected', () => {
    // currentSelection already has the first two leaves; shift-clicking a selected range deselects
    const next = toggleCategorySelection({
      item: findFlat(flat, '5'), // Fine Dining at index 4
      clickedIndex: 4,
      currentSelection: ['2', '3', '4', '5'],
      displayedItems: flat,
      isSearching: false,
      isShiftPressed: true,
      lastClickedIndex: 3, // Fast Food
    });
    // Clicking Fine Dining with it already selected → deselect; range covers idx 3..4 (Fast Food, Fine Dining)
    expect(next.sort()).toEqual(['2', '3']);
  });

  it('toggles self only for each item in the shift-click range when searching', () => {
    // In search mode, range selection must not pull in descendants — only self ids
    const next = toggleCategorySelection({
      item: findFlat(flat, '3'), // Restaurants (has descendants '4', '5')
      clickedIndex: 2,
      currentSelection: [],
      displayedItems: flat,
      isSearching: true,
      isShiftPressed: true,
      lastClickedIndex: 1, // Groceries
    });
    // Range covers Groceries('2') and Restaurants('3'); descendants '4', '5' must NOT be added
    expect(next.sort()).toEqual(['2', '3']);
  });
});

describe('computeSessionRootOrder', () => {
  it('places roots with any selected descendant first, internal last', () => {
    const roots = buildTree();
    const order = computeSessionRootOrder({
      roots,
      // Only Transport has a selected descendant
      selectedIds: new Set(['11']),
    });
    expect(order).toEqual(['10', '1', '100']);
  });

  it('treats a directly selected root as selected', () => {
    const roots = buildTree();
    const order = computeSessionRootOrder({
      roots,
      selectedIds: new Set(['1']),
    });
    expect(order).toEqual(['1', '10', '100']);
  });

  it('keeps internal categories after non-internal when nothing is selected', () => {
    const roots = buildTree();
    const order = computeSessionRootOrder({ roots, selectedIds: new Set() });
    expect(order).toEqual(['1', '10', '100']);
  });

  it('lifts a later-declared root above an earlier-declared unselected one', () => {
    // Only Transport ('10') has a selected descendant; verifies selected-first partition actually reorders.
    const roots = buildTree();
    const order = computeSessionRootOrder({
      roots,
      selectedIds: new Set(['12']),
    });
    expect(order).toEqual(['10', '1', '100']);
  });

  it('returns an empty order when given no roots', () => {
    expect(computeSessionRootOrder({ roots: [], selectedIds: new Set() })).toEqual([]);
  });
});
