import { CATEGORY_TYPES, type RecordId } from '@bt/shared/types';

import { buildCategoriesObjectGraph, findFormattedCategoryById } from './format-categories.helper';

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const category = (id: number) => ({
  id: uuid(id) as RecordId,
  key: null,
  color: '',
  name: 'test',
  icon: null,
  userId: 1,
  parentId: null as RecordId | null,
  type: CATEGORY_TYPES.custom,
  defaultTagIds: [] as RecordId[],
  applyDefaultTagsOnAiCategorization: false,
});

describe('Categories formatting helper', () => {
  test.each([
    ['empty arrays', [], []],

    ['single category', [category(1)], [{ ...category(1), subCategories: [] }]],

    [
      'nested categories',
      [
        category(1),
        category(2),
        { ...category(3), parentId: uuid(2) as RecordId },
        { ...category(4), parentId: uuid(3) as RecordId },
      ],
      [
        { ...category(1), subCategories: [] },
        {
          ...category(2),
          subCategories: [
            {
              ...category(3),
              parentId: uuid(2) as RecordId,
              subCategories: [
                {
                  ...category(4),
                  parentId: uuid(3) as RecordId,
                  subCategories: [],
                },
              ],
            },
          ],
        },
      ],
    ],
  ])('%s', (description, value, expected) => {
    expect(buildCategoriesObjectGraph(value)).toStrictEqual(expected);
  });
});

describe('findFormattedCategoryById', () => {
  const tree = buildCategoriesObjectGraph([
    category(1),
    category(2),
    { ...category(3), parentId: uuid(2) as RecordId },
    { ...category(4), parentId: uuid(3) as RecordId },
  ]);

  test('returns a root-level category', () => {
    expect(findFormattedCategoryById(tree, uuid(1))?.id).toBe(uuid(1));
  });

  test('walks into subCategories to find a nested node', () => {
    expect(findFormattedCategoryById(tree, uuid(3))?.id).toBe(uuid(3));
    expect(findFormattedCategoryById(tree, uuid(4))?.id).toBe(uuid(4));
  });

  test('returns null when no category matches', () => {
    expect(findFormattedCategoryById(tree, uuid(999))).toBeNull();
  });

  test('returns null for empty input', () => {
    expect(findFormattedCategoryById([], uuid(1))).toBeNull();
  });
});
