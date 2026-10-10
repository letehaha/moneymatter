import { type FormattedCategory } from '@/common/types';
import { type BudgetPlanLineEntry, CATEGORY_TYPES, type RecordId } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { buildTakenCategories, collapseCategoryIds, expandCategoryIds } from './line-categories';

const makeCategory = ({
  id,
  subCategories = [],
}: {
  id: string;
  subCategories?: FormattedCategory[];
}): FormattedCategory => ({
  id: id as RecordId,
  key: null,
  name: id,
  color: '#000',
  icon: null,
  parentId: null,
  type: CATEGORY_TYPES.custom,
  userId: 1,
  defaultTagIds: [],
  applyDefaultTagsOnAiCategorization: false,
  subCategories,
});

// housing
//   ├─ rent
//   └─ utilities
//        ├─ power
//        └─ water
// food
//   └─ groceries
const categories = [
  makeCategory({
    id: 'housing',
    subCategories: [
      makeCategory({ id: 'rent' }),
      makeCategory({ id: 'utilities', subCategories: [makeCategory({ id: 'power' }), makeCategory({ id: 'water' })] }),
    ],
  }),
  makeCategory({ id: 'food', subCategories: [makeCategory({ id: 'groceries' })] }),
];

const collapse = ({ categoryIds }: { categoryIds: string[] }) => collapseCategoryIds({ categoryIds, categories });
const expand = ({ categoryIds }: { categoryIds: string[] }) => expandCategoryIds({ categoryIds, categories });

const makeLine = ({ name, categoryIds }: { name: string; categoryIds: string[] }): BudgetPlanLineEntry => ({
  id: name,
  name,
  sortOrder: 0,
  groupId: null,
  activeFrom: '2026-01-01',
  activeUntil: null,
  categoryIds,
});

describe('collapseCategoryIds', () => {
  it('collapses a fully selected parent to the parent', () => {
    expect(collapse({ categoryIds: ['housing', 'rent', 'utilities', 'power', 'water'] })).toEqual(['housing']);
  });

  it('keeps only the checked children when one child of a checked parent is unchecked', () => {
    expect(collapse({ categoryIds: ['housing', 'utilities', 'power', 'water'] })).toEqual(['utilities']);
  });

  it('collapses at the deepest fully selected level across three levels', () => {
    expect(collapse({ categoryIds: ['housing', 'rent', 'utilities', 'power'] })).toEqual(['rent', 'power']);
    expect(collapse({ categoryIds: ['utilities', 'power', 'water', 'groceries'] })).toEqual(['utilities', 'groceries']);
  });

  it('leaves a leaf-only selection unchanged', () => {
    expect(collapse({ categoryIds: ['rent', 'water'] })).toEqual(['rent', 'water']);
  });

  it('keeps ids missing from the tree', () => {
    expect(collapse({ categoryIds: ['rent', 'gone'] })).toEqual(['rent', 'gone']);
  });
});

describe('expandCategoryIds', () => {
  it('returns a parent with its whole subtree', () => {
    expect(expand({ categoryIds: ['housing'] })).toEqual(['housing', 'rent', 'utilities', 'power', 'water']);
  });

  it('dedupes overlapping ids and keeps unknown ones', () => {
    expect(expand({ categoryIds: ['utilities', 'water', 'gone'] })).toEqual(['utilities', 'power', 'water', 'gone']);
  });

  it.each([
    { categoryIds: ['housing'] },
    { categoryIds: ['rent', 'utilities'] },
    { categoryIds: ['power', 'food'] },
    { categoryIds: ['rent', 'gone'] },
  ])('round-trips a top-most set $categoryIds through collapse', ({ categoryIds }) => {
    expect(collapse({ categoryIds: expand({ categoryIds }) })).toEqual(categoryIds);
  });

  it('keeps a fully selected parent with its subtree through collapse', () => {
    const categoryIds = expand({ categoryIds: ['housing'] });
    expect(expand({ categoryIds: collapse({ categoryIds }) })).toEqual(categoryIds);
  });

  it('unchecks a partially selected parent and keeps its fully selected children', () => {
    expect(expand({ categoryIds: collapse({ categoryIds: ['housing', 'utilities', 'power', 'water'] }) })).toEqual([
      'utilities',
      'power',
      'water',
    ]);
  });
});

describe('buildTakenCategories', () => {
  it('marks a line’s categories, their descendants and their ancestors', () => {
    expect(
      buildTakenCategories({ lines: [makeLine({ name: 'Bills', categoryIds: ['utilities'] })], categories }),
    ).toEqual({ housing: 'Bills', utilities: 'Bills', power: 'Bills', water: 'Bills' });
  });

  it('returns nothing without lines', () => {
    expect(buildTakenCategories({ lines: [], categories })).toEqual({});
  });
});
