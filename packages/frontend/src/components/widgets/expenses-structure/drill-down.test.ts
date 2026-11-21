import {
  buildLevelSlices,
  buildTrail,
  buildWidgetAnalyticsLink,
  getLevelTotal,
  getLevelTransactionCategoryIds,
  isDrillStale,
} from './drill-down';

const cat = ({ id, parentId = null, color = '#111111' }: { id: string; parentId?: string | null; color?: string }) => ({
  id,
  name: id,
  color,
  parentId,
});

const categoriesMap = Object.fromEntries(
  [
    cat({ id: 'personal', color: '#ff0000' }),
    cat({ id: 'food', parentId: 'personal', color: '#ff0000' }),
    cat({ id: 'cafe', parentId: 'food' }),
    cat({ id: 'gym', parentId: 'personal', color: '#00ff00' }),
    cat({ id: 'rent' }),
    cat({ id: 'hidden', parentId: 'rent' }),
  ].map((c) => [c.id, c]),
);

describe('buildLevelSlices', () => {
  it('keeps root rows as returned and flags categories with children as drillable', () => {
    const slices = buildLevelSlices({
      spendings: {
        rent: { name: 'rent', color: '#123456', amount: 50 },
        personal: { name: 'personal', color: '#ff0000', amount: 100 },
        empty: { name: 'empty', color: '#000000', amount: 0 },
      },
      drilledCategoryId: null,
      categoriesMap,
      excludedCategoryIds: ['hidden'],
    });

    expect(slices).toEqual([
      { categoryId: 'rent', name: 'rent', color: '#123456', amount: 50, isDrillable: false },
      { categoryId: 'personal', name: 'personal', color: '#ff0000', amount: 100, isDrillable: true },
    ]);
  });

  it('shows children largest first plus a remainder slice, shading copied parent colors', () => {
    const slices = buildLevelSlices({
      spendings: {
        personal: { name: 'personal', color: '#ff0000', amount: 10 },
        food: { name: 'food', color: '#ff0000', amount: 70 },
        gym: { name: 'gym', color: '#00ff00', amount: 20 },
      },
      drilledCategoryId: 'personal',
      categoriesMap,
      excludedCategoryIds: [],
    });

    expect(slices.map((s) => [s.categoryId, s.name, s.isDrillable])).toEqual([
      ['food', 'food', true],
      ['gym', 'gym', false],
      ['personal', 'personal', false],
    ]);
    expect(slices[0]!.color).toBe('#ff0000');
    expect(slices[1]!.color).toBe('#00ff00');
  });

  it('drops a zero remainder', () => {
    const slices = buildLevelSlices({
      spendings: {
        personal: { name: 'personal', color: '#ff0000', amount: 0 },
        gym: { name: 'gym', color: '#00ff00', amount: 20 },
      },
      drilledCategoryId: 'personal',
      categoriesMap,
      excludedCategoryIds: [],
    });

    expect(slices.map((s) => s.categoryId)).toEqual(['gym']);
  });

  it('drops negative amounts', () => {
    const slices = buildLevelSlices({
      spendings: {
        rent: { name: 'rent', color: '#123456', amount: -30 },
        personal: { name: 'personal', color: '#ff0000', amount: 10 },
      },
      drilledCategoryId: null,
      categoriesMap,
      excludedCategoryIds: [],
    });

    expect(slices.map((s) => s.categoryId)).toEqual(['personal']);
  });

  it('drops an excluded child returned at a drilled level', () => {
    const slices = buildLevelSlices({
      spendings: {
        personal: { name: 'personal', color: '#ff0000', amount: 10 },
        food: { name: 'food', color: '#ff0000', amount: 70 },
        gym: { name: 'gym', color: '#00ff00', amount: 20 },
      },
      drilledCategoryId: 'personal',
      categoriesMap,
      excludedCategoryIds: ['gym'],
    });

    expect(slices.map((s) => s.categoryId)).toEqual(['food', 'personal']);
  });

  it('makes a parent non-drillable when all its children are excluded', () => {
    const slices = buildLevelSlices({
      spendings: { food: { name: 'food', color: '#ff0000', amount: 70 } },
      drilledCategoryId: 'personal',
      categoriesMap,
      excludedCategoryIds: ['cafe'],
    });

    expect(slices[0]!.isDrillable).toBe(false);
  });

  it('sorts the remainder like any slice when it is the largest', () => {
    const slices = buildLevelSlices({
      spendings: {
        gym: { name: 'gym', color: '#00ff00', amount: 20 },
        personal: { name: 'personal', color: '#ff0000', amount: 90 },
        food: { name: 'food', color: '#ff0000', amount: 30 },
      },
      drilledCategoryId: 'personal',
      categoriesMap,
      excludedCategoryIds: [],
    });

    expect(slices.map((s) => s.categoryId)).toEqual(['personal', 'food', 'gym']);
  });

  it('gives the remainder a color distinct from every sibling', () => {
    const slices = buildLevelSlices({
      spendings: {
        personal: { name: 'personal', color: '#ff0000', amount: 10 },
        food: { name: 'food', color: '#ff0000', amount: 70 },
        gym: { name: 'gym', color: '#00ff00', amount: 20 },
      },
      drilledCategoryId: 'personal',
      categoriesMap,
      excludedCategoryIds: [],
    });

    const remainder = slices.find((s) => s.categoryId === 'personal')!;
    const siblingColors = slices.filter((s) => s !== remainder).map((s) => s.color);
    expect(siblingColors).not.toContain(remainder.color);
  });

  it('still builds slices when the drilled category is missing from the map', () => {
    const slices = buildLevelSlices({
      spendings: {
        gone: { name: 'gone', color: '#abcdef', amount: 5 },
        orphan: { name: 'orphan', color: '#fedcba', amount: 15 },
      },
      drilledCategoryId: 'gone',
      categoriesMap,
      excludedCategoryIds: [],
    });

    expect(slices.map((s) => [s.categoryId, s.name, s.isDrillable])).toEqual([
      ['orphan', 'orphan', false],
      ['gone', 'gone', false],
    ]);
  });
});

describe('getLevelTransactionCategoryIds', () => {
  const ids = ({
    drilledCategoryId = null,
    excludedCategoryIds = [],
  }: {
    drilledCategoryId?: string | null;
    excludedCategoryIds?: string[];
  }) => {
    const result = getLevelTransactionCategoryIds({ drilledCategoryId, categoriesMap, excludedCategoryIds });
    return Array.isArray(result) ? [...result].sort() : result;
  };

  it('sends no category filter at the root when nothing is excluded', () => {
    expect(ids({})).toBeUndefined();
  });

  it('lists every category outside the excluded subtrees at the root', () => {
    expect(ids({ excludedCategoryIds: ['food'] })).toEqual(['gym', 'hidden', 'personal', 'rent']);
  });

  it('has nothing to open at the root when every category is excluded', () => {
    expect(ids({ excludedCategoryIds: ['personal', 'rent'] })).toBeNull();
  });

  it('opens the drilled subtree without excluded branches', () => {
    expect(ids({ drilledCategoryId: 'personal', excludedCategoryIds: ['food'] })).toEqual(['gym', 'personal']);
  });

  it('opens the whole drilled subtree when nothing is excluded', () => {
    expect(ids({ drilledCategoryId: 'personal' })).toEqual(['cafe', 'food', 'gym', 'personal']);
  });
});

describe('isDrillStale', () => {
  it('is stale when the trail is empty', () => {
    expect(isDrillStale({ trail: [], excludedCategoryIds: [] })).toBe(true);
  });

  it('is stale when the drilled category or an ancestor is excluded', () => {
    const trail = [{ id: 'personal' }, { id: 'food' }];
    expect(isDrillStale({ trail, excludedCategoryIds: ['food'] })).toBe(true);
    expect(isDrillStale({ trail, excludedCategoryIds: ['personal'] })).toBe(true);
  });

  it('is fresh when only unrelated categories are excluded', () => {
    expect(isDrillStale({ trail: [{ id: 'personal' }, { id: 'food' }], excludedCategoryIds: ['cafe', 'rent'] })).toBe(
      false,
    );
  });
});

describe('getLevelTotal', () => {
  it('sums only kept rows: not excluded and positive', () => {
    expect(
      getLevelTotal({
        spendings: {
          rent: { name: 'rent', color: '#123456', amount: 50 },
          personal: { name: 'personal', color: '#ff0000', amount: 100 },
          refund: { name: 'refund', color: '#000000', amount: -30 },
          hidden: { name: 'hidden', color: '#000000', amount: 20 },
        },
        excludedCategoryIds: ['hidden'],
      }),
    ).toBe(150);
  });
});

describe('buildWidgetAnalyticsLink', () => {
  const period = { from: new Date('2026-01-01'), to: new Date('2026-01-31') };

  it('scopes to the drilled category', () => {
    expect(
      buildWidgetAnalyticsLink({ drilledCategoryId: 'food', excludedCategoryIds: ['gym'], metric: 'income', period }),
    ).toEqual({ categoryIds: ['food'], metric: 'income', period });
  });

  it('carries the exclusions at the root', () => {
    expect(
      buildWidgetAnalyticsLink({ drilledCategoryId: null, excludedCategoryIds: ['gym'], metric: 'expenses', period }),
    ).toEqual({ excludedCategoryIds: ['gym'], metric: 'expenses', period });
  });
});

describe('buildTrail', () => {
  it('lists ancestors root first, ending with the category', () => {
    expect(buildTrail({ categoryId: 'cafe', categoriesMap }).map((c) => c.id)).toEqual(['personal', 'food', 'cafe']);
  });

  it('is empty at the root or for an unknown category', () => {
    expect(buildTrail({ categoryId: null, categoriesMap })).toEqual([]);
    expect(buildTrail({ categoryId: 'gone', categoriesMap })).toEqual([]);
  });

  it('stops on a parent cycle', () => {
    const cyclic = { a: cat({ id: 'a', parentId: 'b' }), b: cat({ id: 'b', parentId: 'a' }) };
    expect(buildTrail({ categoryId: 'a', categoriesMap: cyclic }).map((c) => c.id)).toEqual(['b', 'a']);
  });
});
