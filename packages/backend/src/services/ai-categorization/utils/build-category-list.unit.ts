import { CATEGORY_TYPES, CategoryModel } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';

import { buildCategoryList } from './build-category-list';

describe('buildCategoryList', () => {
  const CAT1 = generateRandomRecordId();
  const CAT2 = generateRandomRecordId();
  const CAT3 = generateRandomRecordId();

  const baseCategory = {
    color: '#FF0000',
    icon: null,
    key: null,
    type: CATEGORY_TYPES.custom,
    userId: 1,
    defaultTagIds: [],
    applyDefaultTagsOnAiCategorization: false,
  };

  it('transforms CategoryModel to CategoryForCategorization', () => {
    const categories: CategoryModel[] = [
      {
        ...baseCategory,
        id: CAT1,
        name: 'Food',
        parentId: null,
      },
    ];

    const result = buildCategoryList(categories);

    expect(result).toEqual([
      {
        id: CAT1,
        name: 'Food',
        parentId: null,
      },
    ]);
  });

  it('strips color and icon fields', () => {
    const categories: CategoryModel[] = [
      {
        ...baseCategory,
        id: CAT1,
        name: 'Entertainment',
        parentId: null,
        color: '#00FF00',
        icon: 'heart',
      },
    ];

    const result = buildCategoryList(categories);

    expect(result[0]).not.toHaveProperty('color');
    expect(result[0]).not.toHaveProperty('icon');
  });

  it('preserves parentId relationships', () => {
    const categories: CategoryModel[] = [
      { ...baseCategory, id: CAT1, name: 'Food', parentId: null },
      { ...baseCategory, id: CAT2, name: 'Restaurants', parentId: CAT1 },
      { ...baseCategory, id: CAT3, name: 'Groceries', parentId: CAT1 },
    ];

    const result = buildCategoryList(categories);

    expect(result).toEqual([
      { id: CAT1, name: 'Food', parentId: null },
      { id: CAT2, name: 'Restaurants', parentId: CAT1 },
      { id: CAT3, name: 'Groceries', parentId: CAT1 },
    ]);
  });

  it('returns empty array for empty input', () => {
    const result = buildCategoryList([]);

    expect(result).toEqual([]);
  });

  it('handles multiple root categories', () => {
    const categories: CategoryModel[] = [
      { ...baseCategory, id: CAT1, name: 'Food', parentId: null, color: '#FF0000' },
      { ...baseCategory, id: CAT2, name: 'Transport', parentId: null, color: '#00FF00' },
      { ...baseCategory, id: CAT3, name: 'Entertainment', parentId: null, color: '#0000FF' },
    ];

    const result = buildCategoryList(categories);

    expect(result).toHaveLength(3);
    expect(result.every((c) => c.parentId === null)).toBe(true);
  });
});
