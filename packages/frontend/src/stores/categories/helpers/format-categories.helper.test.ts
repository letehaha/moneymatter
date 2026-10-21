import { CATEGORY_ORDER_ROOT_KEY, CATEGORY_TYPES, type RecordId } from '@bt/shared/types';

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
    expect(buildCategoriesObjectGraph({ items: value })).toStrictEqual(expected);
  });
});

describe('buildCategoriesObjectGraph sorting', () => {
  const named = (id: number, name: string, parentId: number | null = null) => ({
    ...category(id),
    name,
    parentId: parentId === null ? null : (uuid(parentId) as RecordId),
  });
  const items = [
    { ...named(9, 'Transfers'), type: CATEGORY_TYPES.internal },
    named(1, 'food'),
    named(2, 'Bills'),
    named(3, 'Clothes'),
    named(4, 'Lunch', 1),
    named(5, 'Coffee', 1),
    named(6, 'Rent', 2),
  ];
  const names = (nodes: ReturnType<typeof buildCategoriesObjectGraph>): string[] => nodes.map((node) => node.name);

  test('sorts every level alphabetically, case-insensitively, with internal categories last', () => {
    const tree = buildCategoriesObjectGraph({ items });

    expect(names(tree)).toEqual(['Bills', 'Clothes', 'food', 'Transfers']);
    expect(names(tree[2]!.subCategories)).toEqual(['Coffee', 'Lunch']);
  });

  test('puts listed ids first in list order, unlisted ones after alphabetically, ignoring stale ids', () => {
    const tree = buildCategoriesObjectGraph({
      items,
      order: {
        [CATEGORY_ORDER_ROOT_KEY]: [uuid(9), uuid(404), uuid(1)],
        [uuid(1)]: [uuid(4), uuid(5)],
      },
    });

    expect(names(tree)).toEqual(['food', 'Bills', 'Clothes', 'Transfers']);
    expect(names(tree[0]!.subCategories)).toEqual(['Lunch', 'Coffee']);
  });
});

describe('findFormattedCategoryById', () => {
  const tree = buildCategoriesObjectGraph({
    items: [
      category(1),
      category(2),
      { ...category(3), parentId: uuid(2) as RecordId },
      { ...category(4), parentId: uuid(3) as RecordId },
    ],
  });

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
