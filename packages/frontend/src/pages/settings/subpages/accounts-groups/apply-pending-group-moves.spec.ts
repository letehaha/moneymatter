import type { AccountGroups } from '@/common/types/models';
import { buildAccountGroupTree } from '@/common/utils/build-account-group-tree';
import type { AccountModel } from '@bt/shared/types';
import { describe, expect, it, vi } from 'vitest';

import {
  type PendingGroupMove,
  applyPendingMoves,
  netMoves,
  replayMoves,
  sanitizeMoves,
} from './apply-pending-group-moves';
import { flattenGroups } from './build-account-group-list';
import { makeGroup } from './test-fixtures';

// banks > (georgia, vietnam), cash, savings
const buildTree = () =>
  buildAccountGroupTree({
    groups: [
      makeGroup({ id: 'banks' }),
      makeGroup({ id: 'georgia', parentGroupId: 'banks' }),
      makeGroup({ id: 'vietnam', parentGroupId: 'banks' }),
      makeGroup({ id: 'cash' }),
      makeGroup({ id: 'savings' }),
    ],
  });

const parentOf = ({ groups, id }: { groups: AccountGroups[]; id: string }) =>
  flattenGroups({ groups }).find((group) => group.id === id)?.parentGroupId;

describe('netMoves', () => {
  it('keeps the last move per group, ordered by its last occurrence', () => {
    const moves = [
      { groupId: 'cash', parentGroupId: 'banks' },
      { groupId: 'savings', parentGroupId: 'banks' },
      { groupId: 'cash', parentGroupId: 'savings' },
    ];

    expect(netMoves({ moves, groups: buildTree() })).toEqual([
      { groupId: 'savings', parentGroupId: 'banks' },
      { groupId: 'cash', parentGroupId: 'savings' },
    ]);
  });

  it('drops groups that end at their original parent', () => {
    const moves = [
      { groupId: 'georgia', parentGroupId: null },
      { groupId: 'georgia', parentGroupId: 'banks' },
    ];

    expect(netMoves({ moves, groups: buildTree() })).toEqual([]);
  });

  it('drops groups that no longer exist', () => {
    expect(
      netMoves({
        moves: [{ groupId: 'gone', parentGroupId: null }],
        groups: buildTree(),
      }),
    ).toEqual([]);
  });

  it('drops moves whose target group no longer exists', () => {
    expect(
      netMoves({
        moves: [
          { groupId: 'cash', parentGroupId: 'gone' },
          { groupId: 'savings', parentGroupId: 'cash' },
        ],
        groups: buildTree(),
      }),
    ).toEqual([{ groupId: 'savings', parentGroupId: 'cash' }]);
  });

  it('keeps a move that depended on a round trip which nets out', () => {
    const moves = [
      { groupId: 'georgia', parentGroupId: null },
      { groupId: 'vietnam', parentGroupId: 'georgia' },
      { groupId: 'georgia', parentGroupId: 'banks' },
    ];

    expect(netMoves({ moves, groups: buildTree() })).toEqual([{ groupId: 'vietnam', parentGroupId: 'georgia' }]);
  });
});

describe('replayMoves', () => {
  // A fake server: rejects any move whose target sits inside the moved group's subtree.
  const makeServer = ({ parents }: { parents: Record<string, string | null> }) => {
    const parentById = new Map(Object.entries(parents));
    const apply = vi.fn(async ({ move }: { move: PendingGroupMove }) => {
      for (let id = move.parentGroupId; id !== null; id = parentById.get(id) ?? null) {
        if (id === move.groupId) throw new Error(`cycle:${move.groupId}`);
      }
      parentById.set(move.groupId, move.parentGroupId);
    });
    return { apply, parentById };
  };

  it('retries a move that transiently formed a cycle once a later move lands', async () => {
    const { apply, parentById } = makeServer({ parents: { a: null, b: 'a' } });

    const result = await replayMoves({
      moves: [
        { groupId: 'a', parentGroupId: 'b' },
        { groupId: 'b', parentGroupId: null },
      ],
      apply,
    });

    expect(result).toEqual({ remaining: [], lastError: undefined });
    expect(apply).toHaveBeenCalledTimes(3);
    expect(parentById.get('a')).toBe('b');
    expect(parentById.get('b')).toBeNull();
  });

  it('stops after a pass where every move fails and returns them all with the last error', async () => {
    const { apply } = makeServer({ parents: { a: null, b: 'a' } });
    const moves = [{ groupId: 'a', parentGroupId: 'b' }];

    const { remaining, lastError } = await replayMoves({ moves, apply });

    expect(remaining).toEqual(moves);
    expect((lastError as Error).message).toBe('cycle:a');
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('keeps the original order of the moves that still fail after partial progress', async () => {
    const failing = new Set(['c', 'e']);
    const apply = vi.fn(async ({ move }: { move: PendingGroupMove }) => {
      if (failing.has(move.groupId)) throw new Error(move.groupId);
    });

    const { remaining, lastError } = await replayMoves({
      moves: [
        { groupId: 'c', parentGroupId: null },
        { groupId: 'd', parentGroupId: null },
        { groupId: 'e', parentGroupId: null },
      ],
      apply,
    });

    expect(remaining).toEqual([
      { groupId: 'c', parentGroupId: null },
      { groupId: 'e', parentGroupId: null },
    ]);
    expect((lastError as Error).message).toBe('e');
    expect(apply).toHaveBeenCalledTimes(5);
  });

  it('never calls apply for an empty queue', async () => {
    const apply = vi.fn(async () => undefined);

    expect(await replayMoves({ moves: [], apply })).toEqual({ remaining: [], lastError: undefined });
    expect(apply).not.toHaveBeenCalled();
  });
});

describe('applyPendingMoves', () => {
  it('returns the input tree untouched when nothing is queued', () => {
    const groups = buildTree();
    expect(applyPendingMoves({ groups, moves: [] })).toBe(groups);
  });

  it('re-parents groups in the preview tree', () => {
    const groups = applyPendingMoves({
      groups: buildTree(),
      moves: [
        { groupId: 'cash', parentGroupId: 'georgia' },
        { groupId: 'vietnam', parentGroupId: null },
      ],
    });

    expect(groups.map((group) => group.id).sort()).toEqual(['banks', 'savings', 'vietnam']);
    expect(parentOf({ groups, id: 'cash' })).toBe('georgia');
    const georgia = flattenGroups({ groups }).find((group) => group.id === 'georgia');
    expect(georgia?.childGroups.map((group) => group.id)).toEqual(['cash']);
  });

  it('skips moves whose group or target is missing', () => {
    const groups = applyPendingMoves({
      groups: buildTree(),
      moves: [
        { groupId: 'cash', parentGroupId: 'gone' },
        { groupId: 'gone', parentGroupId: 'banks' },
      ],
    });

    expect(parentOf({ groups, id: 'cash' })).toBeNull();
    expect(flattenGroups({ groups })).toHaveLength(5);
  });

  it('carries the moved group subtree and accounts along', () => {
    const account = { id: 'acc-1', name: 'Card' } as AccountModel;
    const groups = applyPendingMoves({
      groups: buildAccountGroupTree({
        groups: [
          makeGroup({ id: 'banks' }),
          makeGroup({ id: 'georgia', parentGroupId: 'banks', accounts: [account] }),
          makeGroup({ id: 'tbilisi', parentGroupId: 'georgia' }),
          makeGroup({ id: 'cash' }),
        ],
      }),
      moves: [{ groupId: 'georgia', parentGroupId: 'cash' }],
    });

    const cash = groups.find((group) => group.id === 'cash');
    const georgia = cash?.childGroups.find((group) => group.id === 'georgia');
    expect(georgia?.accounts).toEqual([account]);
    expect(georgia?.childGroups.map((group) => group.id)).toEqual(['tbilisi']);
    expect(groups.find((group) => group.id === 'banks')?.childGroups).toEqual([]);
  });
});

describe('sanitizeMoves', () => {
  it('keeps a queue that still replays cleanly', () => {
    const moves = [
      { groupId: 'georgia', parentGroupId: null },
      { groupId: 'banks', parentGroupId: 'georgia' },
    ];

    expect(sanitizeMoves({ groups: buildTree(), moves })).toEqual(moves);
  });

  it('drops moves whose group or target disappeared', () => {
    const moves = [
      { groupId: 'gone', parentGroupId: null },
      { groupId: 'cash', parentGroupId: 'gone' },
      { groupId: 'savings', parentGroupId: 'cash' },
    ];

    expect(sanitizeMoves({ groups: buildTree(), moves })).toEqual([{ groupId: 'savings', parentGroupId: 'cash' }]);
  });

  it('drops moves that would form a cycle against the fresh tree', () => {
    const groups = buildAccountGroupTree({
      groups: [makeGroup({ id: 'a' }), makeGroup({ id: 'b', parentGroupId: 'a' })],
    });

    expect(sanitizeMoves({ groups, moves: [{ groupId: 'a', parentGroupId: 'b' }] })).toEqual([]);
  });

  it('drops a move that already matches the refetched parent', () => {
    const groups = buildAccountGroupTree({
      groups: [makeGroup({ id: 'banks' }), makeGroup({ id: 'cash', parentGroupId: 'banks' })],
    });

    expect(sanitizeMoves({ groups, moves: [{ groupId: 'cash', parentGroupId: 'banks' }] })).toEqual([]);
  });

  it('drops a move into a deeper descendant', () => {
    const groups = buildAccountGroupTree({
      groups: [
        makeGroup({ id: 'a' }),
        makeGroup({ id: 'b', parentGroupId: 'a' }),
        makeGroup({ id: 'c', parentGroupId: 'b' }),
      ],
    });

    expect(sanitizeMoves({ groups, moves: [{ groupId: 'a', parentGroupId: 'c' }] })).toEqual([]);
  });
});
