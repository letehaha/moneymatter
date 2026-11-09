import { collectSubtreeIds, getAncestors, hasChildren, isRemainderRow } from './category-tree';

// Food(1) › Groceries(2) › Organic(4); Food › Restaurants(3); Transport(5)
const TREE = [
  { id: '1', parentId: null, name: 'Food' },
  { id: '2', parentId: '1', name: 'Groceries' },
  { id: '3', parentId: '1', name: 'Restaurants' },
  { id: '4', parentId: '2', name: 'Organic' },
  { id: '5', parentId: null, name: 'Transport' },
];
const MAP = Object.fromEntries(TREE.map((category) => [category.id, category]));

describe('hasChildren', () => {
  it('is true only for categories with subcategories', () => {
    expect(hasChildren({ id: '1', categories: TREE })).toBe(true);
    expect(hasChildren({ id: '4', categories: TREE })).toBe(false);
    expect(hasChildren({ id: undefined, categories: TREE })).toBe(false);
  });
});

describe('getAncestors', () => {
  it('lists ancestors root first', () => {
    expect(getAncestors({ id: '4', categoriesMap: MAP }).map((c) => c.id)).toEqual(['1', '2']);
  });

  it('is empty for a root category', () => {
    expect(getAncestors({ id: '1', categoriesMap: MAP })).toEqual([]);
  });

  it('stops below the stop id', () => {
    expect(getAncestors({ id: '4', categoriesMap: MAP, stopId: '1' }).map((c) => c.id)).toEqual(['2']);
    expect(getAncestors({ id: '4', categoriesMap: MAP, stopId: '2' })).toEqual([]);
  });
});

describe('collectSubtreeIds', () => {
  it('collects the root and every descendant', () => {
    expect(collectSubtreeIds({ rootId: '1', categories: TREE }).sort()).toEqual(['1', '2', '3', '4']);
    expect(collectSubtreeIds({ rootId: '5', categories: TREE })).toEqual(['5']);
  });
});

describe('isRemainderRow', () => {
  it('by level, marks only the scope when it has subcategories', () => {
    expect(isRemainderRow({ id: '1', scopeId: '1', detail: false, categories: TREE })).toBe(true);
    expect(isRemainderRow({ id: '2', scopeId: '1', detail: false, categories: TREE })).toBe(false);
    expect(isRemainderRow({ id: '5', scopeId: '5', detail: false, categories: TREE })).toBe(false);
  });

  it('in detail, marks every category with subcategories', () => {
    expect(isRemainderRow({ id: '2', scopeId: '1', detail: true, categories: TREE })).toBe(true);
    expect(isRemainderRow({ id: '1', scopeId: undefined, detail: true, categories: TREE })).toBe(true);
    expect(isRemainderRow({ id: '4', scopeId: '1', detail: true, categories: TREE })).toBe(false);
  });
});
