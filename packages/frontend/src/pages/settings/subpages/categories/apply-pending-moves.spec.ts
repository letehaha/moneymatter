import { type CategoryModel } from '@bt/shared/types';

import { applyPendingMoves, netMoves, reorderSiblingIds, sanitizeMoves } from './apply-pending-moves';
import { category, uuid } from './test-fixtures';

const parentsOf = (categories: CategoryModel[]) => categories.map((c) => [c.name, c.parentId] as const);

describe('applyPendingMoves', () => {
  test('returns the input untouched when there is nothing pending', () => {
    const categories = [category({ id: 1 }), category({ id: 2, parentId: 1 })];

    expect(applyPendingMoves({ categories, moves: [] })).toBe(categories);
  });

  test('reparents a single category without mutating the source list', () => {
    const categories = [category({ id: 1 }), category({ id: 2 }), category({ id: 3, parentId: 1 })];

    const result = applyPendingMoves({ categories, moves: [{ categoryId: uuid(3), parentId: uuid(2) }] });

    expect(parentsOf(result)).toEqual([
      ['category-1', null],
      ['category-2', null],
      ['category-3', uuid(2)],
    ]);
    expect(categories[2]!.parentId).toBe(uuid(1));
  });

  test('lets a later move of the same category override an earlier one', () => {
    const categories = [category({ id: 1 }), category({ id: 2 }), category({ id: 3 })];

    const result = applyPendingMoves({
      categories,
      moves: [
        { categoryId: uuid(3), parentId: uuid(1) },
        { categoryId: uuid(3), parentId: uuid(2) },
      ],
    });

    expect(result[2]!.parentId).toBe(uuid(2));
  });

  test('applies a sequence of moves in order', () => {
    const categories = [category({ id: 1 }), category({ id: 2 }), category({ id: 3 })];

    const result = applyPendingMoves({
      categories,
      moves: [
        { categoryId: uuid(2), parentId: uuid(1) },
        { categoryId: uuid(3), parentId: uuid(2) },
        { categoryId: uuid(2), parentId: null },
      ],
    });

    expect(parentsOf(result)).toEqual([
      ['category-1', null],
      ['category-2', null],
      ['category-3', uuid(2)],
    ]);
  });

  test('moves a nested category to the top level', () => {
    const categories = [category({ id: 1 }), category({ id: 2, parentId: 1 })];

    const result = applyPendingMoves({ categories, moves: [{ categoryId: uuid(2), parentId: null }] });

    expect(result[1]!.parentId).toBeNull();
  });

  test('skips moves whose category or target no longer exists, keeping the forest well-formed', () => {
    const categories = [category({ id: 1 }), category({ id: 2 })];

    const result = applyPendingMoves({
      categories,
      moves: [
        { categoryId: uuid(2), parentId: uuid(99) },
        { categoryId: uuid(99), parentId: uuid(1) },
      ],
    });

    expect(parentsOf(result)).toEqual([
      ['category-1', null],
      ['category-2', null],
    ]);
  });
});

describe('netMoves', () => {
  const categories = [category({ id: 1, parentId: 2 }), category({ id: 2 }), category({ id: 3, parentId: 1 })];

  test('keeps only the last move per category, preserving first-seen order', () => {
    const result = netMoves({
      categories,
      moves: [
        { categoryId: uuid(1), parentId: uuid(2) },
        { categoryId: uuid(3), parentId: null },
        { categoryId: uuid(1), parentId: null },
      ],
    });

    expect(result).toEqual([
      { categoryId: uuid(1), parentId: null },
      { categoryId: uuid(3), parentId: null },
    ]);
  });

  test('drops a category whose last move returns it to its original parent', () => {
    const result = netMoves({
      categories,
      moves: [
        { categoryId: uuid(3), parentId: null },
        { categoryId: uuid(1), parentId: null },
        { categoryId: uuid(3), parentId: uuid(1) },
      ],
    });

    expect(result).toEqual([{ categoryId: uuid(1), parentId: null }]);
  });

  test('drops a move whose category no longer exists', () => {
    const result = netMoves({ categories, moves: [{ categoryId: uuid(99), parentId: null }] });

    expect(result).toEqual([]);
  });

  test('returns an empty list for an empty queue', () => {
    expect(netMoves({ categories, moves: [] })).toEqual([]);
  });
});

describe('sanitizeMoves', () => {
  const MAX_NESTING = 3;

  test('keeps a chain that still replays cleanly', () => {
    // B leaves A's subtree, then A moves under B; valid only in this order.
    const categories = [category({ id: 1 }), category({ id: 2, parentId: 1 })];
    const moves = [
      { categoryId: uuid(2), parentId: null },
      { categoryId: uuid(1), parentId: uuid(2) },
    ];

    expect(sanitizeMoves({ categories, moves, maxNesting: MAX_NESTING })).toEqual(moves);
  });

  test('drops a move that only an unqueued predecessor made legal', () => {
    // With "B → top level" removed, "A → B" would parent A under its own child.
    const categories = [category({ id: 1 }), category({ id: 2, parentId: 1 })];

    expect(
      sanitizeMoves({ categories, moves: [{ categoryId: uuid(1), parentId: uuid(2) }], maxNesting: MAX_NESTING }),
    ).toEqual([]);
  });

  test('drops moves referencing a deleted category or a deleted target', () => {
    const categories = [category({ id: 1 }), category({ id: 2 })];

    expect(
      sanitizeMoves({
        categories,
        moves: [
          { categoryId: uuid(99), parentId: uuid(1) },
          { categoryId: uuid(2), parentId: uuid(99) },
        ],
        maxNesting: MAX_NESTING,
      }),
    ).toEqual([]);
  });

  test('drops a move that would exceed the nesting limit in the new tree', () => {
    // 1 > 2 is depth 2; moving 3 (which has child 4) under 2 would reach depth 4.
    const categories = [
      category({ id: 1 }),
      category({ id: 2, parentId: 1 }),
      category({ id: 3 }),
      category({ id: 4, parentId: 3 }),
    ];

    expect(
      sanitizeMoves({ categories, moves: [{ categoryId: uuid(3), parentId: uuid(2) }], maxNesting: MAX_NESTING }),
    ).toEqual([]);
  });

  test('drops a move that became a no-op, keeping independent survivors', () => {
    const categories = [category({ id: 1 }), category({ id: 2, parentId: 1 }), category({ id: 3 })];
    const noop = { categoryId: uuid(2), parentId: uuid(1) };
    const independent = { categoryId: uuid(3), parentId: uuid(1) };

    expect(sanitizeMoves({ categories, moves: [noop, independent], maxNesting: MAX_NESTING })).toEqual([independent]);
  });
});

describe('reorderSiblingIds', () => {
  const [a, b, c] = [uuid(1), uuid(2), uuid(3)];

  test.each([
    ['moves the first sibling after the last', a, c, 'after', [b, c, a]],
    ['moves the last sibling before the first', c, a, 'before', [c, a, b]],
    ['places a sibling right after its neighbour', a, b, 'after', [b, a, c]],
    ['inserts a newly re-parented category without duplicating it', uuid(9), b, 'before', [a, uuid(9), b, c]],
  ] as const)('%s', (_, draggedId, targetId, position, expected) => {
    expect(reorderSiblingIds({ siblingIds: [a, b, c], draggedId, targetId, position })).toEqual(expected);
  });

  test('keeps a single copy when the dragged id is already among the siblings', () => {
    expect(
      reorderSiblingIds({ siblingIds: [a, uuid(9), b], draggedId: uuid(9), targetId: a, position: 'before' }),
    ).toEqual([uuid(9), a, b]);
  });

  test('returns null when the target is not among the siblings', () => {
    expect(reorderSiblingIds({ siblingIds: [a, b], draggedId: a, targetId: c, position: 'after' })).toBeNull();
  });
});
