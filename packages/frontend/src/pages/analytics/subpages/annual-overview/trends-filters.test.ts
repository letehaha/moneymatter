import { TRANSACTION_TYPES } from '@bt/shared/types';

import {
  type TrendsFilters,
  countActiveFilters,
  emptyTrendsFilters,
  filtersFromDeepLink,
  getScopeCategoryId,
  getTransactionCategoryIds,
  hideCategory,
  parseTrendsFilters,
  scopeTo,
  showCategory,
  toStatsFilterParams,
  toTransactionFilterParams,
} from './trends-filters';

const makeFilters = (overrides: Partial<TrendsFilters> = {}): TrendsFilters => ({
  ...emptyTrendsFilters(),
  ...overrides,
});

describe('toStatsFilterParams', () => {
  it('returns an empty object when nothing is selected', () => {
    expect(toStatsFilterParams({ filters: makeFilters() })).toEqual({});
  });

  it('maps categories to categoryIds in include mode', () => {
    expect(toStatsFilterParams({ filters: makeFilters({ categories: { mode: 'include', ids: ['1', '2'] } }) })).toEqual(
      { categoryIds: ['1', '2'] },
    );
  });

  it('maps categories to excludedCategoryIds in exclude mode', () => {
    expect(toStatsFilterParams({ filters: makeFilters({ categories: { mode: 'exclude', ids: ['1'] } }) })).toEqual({
      excludedCategoryIds: ['1'],
    });
  });

  it('maps payees to excludedPayeeIds in exclude mode', () => {
    expect(toStatsFilterParams({ filters: makeFilters({ payees: { mode: 'exclude', ids: ['p1', 'p2'] } }) })).toEqual({
      excludedPayeeIds: ['p1', 'p2'],
    });
  });

  it('maps tags to excludedTagIds in exclude mode', () => {
    expect(toStatsFilterParams({ filters: makeFilters({ tags: { mode: 'exclude', ids: ['t1'] } }) })).toEqual({
      excludedTagIds: ['t1'],
    });
  });

  it('omits empty groups and passes through the rest', () => {
    expect(
      toStatsFilterParams({
        filters: makeFilters({ accountIds: ['a'], tags: { mode: 'include', ids: ['t1', 't2'] } }),
      }),
    ).toEqual({ accountIds: ['a'], tagIds: ['t1', 't2'] });
  });

  it('omits a group whose mode is exclude but has no ids', () => {
    expect(toStatsFilterParams({ filters: makeFilters({ payees: { mode: 'exclude', ids: [] } }) })).toEqual({});
  });
});

// Food(1) › Groceries(2) › Organic(4); Food › Restaurants(3); Transport(5)
const TREE = [
  { id: '1', parentId: null },
  { id: '2', parentId: '1' },
  { id: '3', parentId: '1' },
  { id: '4', parentId: '2' },
  { id: '5', parentId: null },
];

describe('toStatsFilterParams with a single scope category', () => {
  it('sends the scope with its direct children only', () => {
    expect(
      toStatsFilterParams({ filters: makeFilters({ categories: { mode: 'include', ids: ['1'] } }), categories: TREE }),
    ).toEqual({ categoryIds: ['1', '2', '3'] });
  });

  it('sends just the scope for a category without subcategories', () => {
    expect(
      toStatsFilterParams({ filters: makeFilters({ categories: { mode: 'include', ids: ['5'] } }), categories: TREE }),
    ).toEqual({ categoryIds: ['5'] });
  });

  it('leaves a multi-category selection as is', () => {
    expect(
      toStatsFilterParams({
        filters: makeFilters({ categories: { mode: 'include', ids: ['1', '5'] } }),
        categories: TREE,
      }),
    ).toEqual({ categoryIds: ['1', '5'] });
  });

  it('does not expand a single excluded category', () => {
    expect(
      toStatsFilterParams({ filters: makeFilters({ categories: { mode: 'exclude', ids: ['1'] } }), categories: TREE }),
    ).toEqual({ excludedCategoryIds: ['1'] });
  });
});

describe('toStatsFilterParams in detail mode', () => {
  it('sends every category when nothing is selected', () => {
    expect(toStatsFilterParams({ filters: makeFilters(), categories: TREE, detail: true })).toEqual({
      categoryIds: ['1', '2', '3', '4', '5'],
    });
  });

  it('sends the whole subtree of the scope', () => {
    expect(
      toStatsFilterParams({
        filters: makeFilters({ categories: { mode: 'include', ids: ['1'] } }),
        categories: TREE,
        detail: true,
      }).categoryIds?.sort(),
    ).toEqual(['1', '2', '3', '4']);
  });

  it('turns an exclusion into the categories left over', () => {
    expect(
      toStatsFilterParams({
        filters: makeFilters({ categories: { mode: 'exclude', ids: ['2'] } }),
        categories: TREE,
        detail: true,
      }),
    ).toEqual({ categoryIds: ['1', '3', '5'] });
  });

  it('keeps payee, tag and account params', () => {
    expect(
      toStatsFilterParams({
        filters: makeFilters({
          payees: { mode: 'include', ids: ['p1'] },
          tags: { mode: 'exclude', ids: ['t1'] },
          accountIds: ['a'],
        }),
        categories: TREE,
        detail: true,
      }),
    ).toEqual({
      categoryIds: ['1', '2', '3', '4', '5'],
      payeeIds: ['p1'],
      excludedTagIds: ['t1'],
      accountIds: ['a'],
    });
  });
});

describe('getScopeCategoryId', () => {
  it('returns the id of a single included category', () => {
    expect(getScopeCategoryId({ filters: makeFilters({ categories: { mode: 'include', ids: ['1'] } }) })).toBe('1');
  });

  it('is undefined for several, none, or an exclusion', () => {
    expect(getScopeCategoryId({ filters: makeFilters({ categories: { mode: 'include', ids: ['1', '2'] } }) })).toBe(
      undefined,
    );
    expect(getScopeCategoryId({ filters: makeFilters() })).toBe(undefined);
    expect(getScopeCategoryId({ filters: makeFilters({ categories: { mode: 'exclude', ids: ['1'] } }) })).toBe(
      undefined,
    );
  });
});

describe('getTransactionCategoryIds', () => {
  it('is undefined when no category is selected', () => {
    expect(getTransactionCategoryIds({ filters: makeFilters(), categories: TREE })).toBe(undefined);
  });

  it('includes every descendant of the included categories', () => {
    expect(
      getTransactionCategoryIds({
        filters: makeFilters({ categories: { mode: 'include', ids: ['1'] } }),
        categories: TREE,
      })?.sort(),
    ).toEqual(['1', '2', '3', '4']);
  });

  it('lists everything outside the excluded subtrees', () => {
    expect(
      getTransactionCategoryIds({
        filters: makeFilters({ categories: { mode: 'exclude', ids: ['2'] } }),
        categories: TREE,
      })?.sort(),
    ).toEqual(['1', '3', '5']);
  });
});

describe('toTransactionFilterParams', () => {
  it('sends only the transaction type when nothing is selected', () => {
    expect(toTransactionFilterParams({ filters: makeFilters(), categories: TREE, metric: 'expenses' })).toEqual({
      transactionType: TRANSACTION_TYPES.expense,
    });
  });

  it('expands an inclusion to whole subtrees', () => {
    expect(
      toTransactionFilterParams({
        filters: makeFilters({ categories: { mode: 'include', ids: ['2'] } }),
        categories: TREE,
        metric: 'income',
      }),
    ).toEqual({ categoryIds: ['2', '4'], transactionType: TRANSACTION_TYPES.income });
  });

  it('turns an exclusion into the categories left over', () => {
    expect(
      toTransactionFilterParams({
        filters: makeFilters({ categories: { mode: 'exclude', ids: ['1'] } }),
        categories: TREE,
        metric: 'expenses',
      }),
    ).toEqual({ categoryIds: ['5'], transactionType: TRANSACTION_TYPES.expense });
  });

  it('passes accounts through and leaves payees and tags out', () => {
    expect(
      toTransactionFilterParams({
        filters: makeFilters({
          accountIds: ['a'],
          payees: { mode: 'include', ids: ['p1'] },
          tags: { mode: 'include', ids: ['t1'] },
        }),
        categories: TREE,
        metric: 'expenses',
      }),
    ).toEqual({ accountIds: ['a'], transactionType: TRANSACTION_TYPES.expense });
  });
});

describe('scopeTo', () => {
  it('replaces the category selection with an inclusion of exactly these ids', () => {
    const filters = makeFilters({ categories: { mode: 'exclude', ids: ['1'] }, accountIds: ['a'] });
    expect(scopeTo({ filters, categoryIds: ['2'] })).toEqual(
      makeFilters({ categories: { mode: 'include', ids: ['2'] }, accountIds: ['a'] }),
    );
  });

  it('clears the selection with no ids', () => {
    expect(scopeTo({ filters: makeFilters({ categories: { mode: 'include', ids: ['1'] } }), categoryIds: [] })).toEqual(
      makeFilters(),
    );
  });
});

describe('countActiveFilters', () => {
  it('counts zero for empty filters', () => {
    expect(countActiveFilters({ filters: makeFilters() })).toBe(0);
  });

  it('counts a group once regardless of how many ids it holds', () => {
    expect(countActiveFilters({ filters: makeFilters({ tags: { mode: 'include', ids: ['1', '2', '3'] } }) })).toBe(1);
  });

  it('ignores categories, which the category bar owns', () => {
    expect(countActiveFilters({ filters: makeFilters({ categories: { mode: 'include', ids: ['1'] } }) })).toBe(0);
  });

  it('counts each non-empty group once', () => {
    expect(
      countActiveFilters({
        filters: makeFilters({
          categories: { mode: 'include', ids: ['1'] },
          payees: { mode: 'exclude', ids: ['p'] },
          tags: { mode: 'include', ids: ['t'] },
          accountIds: ['a'],
        }),
      }),
    ).toBe(3);
  });
});

describe('hideCategory', () => {
  it('flips an empty include list to excluding that category', () => {
    expect(hideCategory({ filters: makeFilters(), categoryId: '1' })).toEqual(
      makeFilters({ categories: { mode: 'exclude', ids: ['1'] } }),
    );
  });

  it('removes the category from a non-empty include list', () => {
    expect(
      hideCategory({ filters: makeFilters({ categories: { mode: 'include', ids: ['1', '2'] } }), categoryId: '1' }),
    ).toEqual(makeFilters({ categories: { mode: 'include', ids: ['2'] } }));
  });

  it('flips to exclude when the last included category is hidden', () => {
    expect(
      hideCategory({ filters: makeFilters({ categories: { mode: 'include', ids: ['1'] } }), categoryId: '1' }),
    ).toEqual(makeFilters({ categories: { mode: 'exclude', ids: ['1'] } }));
  });

  it('appends to the exclude list', () => {
    expect(
      hideCategory({ filters: makeFilters({ categories: { mode: 'exclude', ids: ['1'] } }), categoryId: '2' }),
    ).toEqual(makeFilters({ categories: { mode: 'exclude', ids: ['1', '2'] } }));
  });

  it('is a no-op when the category is already excluded', () => {
    const filters = makeFilters({ categories: { mode: 'exclude', ids: ['1'] } });
    expect(hideCategory({ filters, categoryId: '1' })).toBe(filters);
  });

  it('leaves the other groups untouched', () => {
    const filters = makeFilters({ payees: { mode: 'exclude', ids: ['p'] }, accountIds: ['a'] });
    const next = hideCategory({ filters, categoryId: '1' });
    expect(next.payees).toEqual({ mode: 'exclude', ids: ['p'] });
    expect(next.accountIds).toEqual(['a']);
  });

  it('does not mutate the input', () => {
    const filters = makeFilters({ categories: { mode: 'include', ids: ['1', '2'] } });
    hideCategory({ filters, categoryId: '1' });
    expect(filters.categories.ids).toEqual(['1', '2']);
  });
});

describe('showCategory', () => {
  it('removes the category from the exclude list', () => {
    expect(
      showCategory({ filters: makeFilters({ categories: { mode: 'exclude', ids: ['1', '2'] } }), categoryId: '1' }),
    ).toEqual(makeFilters({ categories: { mode: 'exclude', ids: ['2'] } }));
  });

  it('is a no-op in include mode', () => {
    const filters = makeFilters({ categories: { mode: 'include', ids: ['1'] } });
    expect(showCategory({ filters, categoryId: '1' })).toBe(filters);
  });
});

describe('parseTrendsFilters', () => {
  it('round-trips the current shape', () => {
    const filters = makeFilters({ tags: { mode: 'exclude', ids: ['t1'] }, accountIds: ['a'] });
    expect(parseTrendsFilters({ raw: JSON.stringify(filters) })).toEqual(filters);
  });

  it('falls back to empty filters for a stored value of the old flat shape', () => {
    const legacy = JSON.stringify({
      categoryMode: 'exclude',
      categoryIds: ['1'],
      accountIds: [],
      payeeIds: [],
      tagIds: [],
    });
    expect(parseTrendsFilters({ raw: legacy })).toEqual(emptyTrendsFilters());
  });

  it('falls back to empty filters when a group has an unknown mode', () => {
    const raw = JSON.stringify({ ...emptyTrendsFilters(), tags: { mode: 'only', ids: ['t1'] } });
    expect(parseTrendsFilters({ raw })).toEqual(emptyTrendsFilters());
  });

  it('falls back to empty filters when a group holds non-string ids', () => {
    const raw = JSON.stringify({ ...emptyTrendsFilters(), payees: { mode: 'include', ids: [1, 2] } });
    expect(parseTrendsFilters({ raw })).toEqual(emptyTrendsFilters());
  });

  it('falls back to empty filters when accountIds holds non-string values', () => {
    const raw = JSON.stringify({ ...emptyTrendsFilters(), accountIds: [1, 2] });
    expect(parseTrendsFilters({ raw })).toEqual(emptyTrendsFilters());
  });

  it('falls back to empty filters for unparsable input', () => {
    expect(parseTrendsFilters({ raw: 'not json' })).toEqual(emptyTrendsFilters());
  });
});

describe('emptyTrendsFilters', () => {
  it('returns a fresh object each call so callers cannot alias shared state', () => {
    const first = emptyTrendsFilters();
    const second = emptyTrendsFilters();
    first.categories.ids.push('1');
    expect(second.categories.ids).toEqual([]);
  });
});

describe('filtersFromDeepLink', () => {
  const current = makeFilters({
    categories: { mode: 'include', ids: ['9'] },
    payees: { mode: 'include', ids: ['p1'] },
    accountIds: ['a1'],
  });

  it('replaces every filter with the linked categories when the link has a metric', () => {
    expect(
      filtersFromDeepLink({
        filters: current,
        link: { categoryIds: ['1'], excludedCategoryIds: [], metric: 'expenses' },
      }),
    ).toEqual(makeFilters({ categories: { mode: 'include', ids: ['1'] } }));
  });

  it('excludes the linked categories from an otherwise empty view', () => {
    expect(
      filtersFromDeepLink({
        filters: current,
        link: { categoryIds: [], excludedCategoryIds: ['2', '3'], metric: 'income' },
      }),
    ).toEqual(makeFilters({ categories: { mode: 'exclude', ids: ['2', '3'] } }));
  });

  it('resets to empty filters for a metric link without categories', () => {
    expect(
      filtersFromDeepLink({ filters: current, link: { categoryIds: [], excludedCategoryIds: [], metric: 'expenses' } }),
    ).toEqual(emptyTrendsFilters());
  });

  it('only rescopes the categories when the link has no metric', () => {
    expect(filtersFromDeepLink({ filters: current, link: { categoryIds: ['1'], excludedCategoryIds: [] } })).toEqual({
      ...current,
      categories: { mode: 'include', ids: ['1'] },
    });
  });

  it('leaves filters untouched for a no-metric link without categories', () => {
    expect(filtersFromDeepLink({ filters: current, link: { categoryIds: [], excludedCategoryIds: ['2'] } })).toBe(
      current,
    );
  });
});
