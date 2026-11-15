import type { ChatThreadSearchHit } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { groupThreads } from './group-threads';

const thread = ({ id, pinned = false }: { id: string; pinned?: boolean }): ChatThreadSearchHit => ({
  id,
  title: id,
  titleSource: 'auto',
  pinned,
  lastMessageAt: '2026-03-05T10:00:00.000Z',
  expiresAt: null,
  usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
  connectionId: null,
  modelId: null,
  pageContext: null,
  pageContextNames: {},
  createdAt: '2026-03-05T10:00:00.000Z',
});

describe('groupThreads', () => {
  it('puts pinned threads first and keeps the order within a group', () => {
    const groups = groupThreads({
      threads: [
        thread({ id: 'a' }),
        thread({ id: 'b', pinned: true }),
        thread({ id: 'c' }),
        thread({ id: 'd', pinned: true }),
      ],
      isSearching: false,
    });

    expect(groups.map((group) => [group.key, group.threads.map(({ id }) => id)])).toEqual([
      ['pinned', ['b', 'd']],
      ['recent', ['a', 'c']],
    ]);
  });

  it('has no pinned group when nothing is pinned, and no recent group when everything is', () => {
    expect(groupThreads({ threads: [thread({ id: 'a' })], isSearching: false }).map(({ key }) => key)).toEqual([
      'recent',
    ]);
    expect(
      groupThreads({ threads: [thread({ id: 'a', pinned: true })], isSearching: false }).map(({ key }) => key),
    ).toEqual(['pinned']);
  });

  it('shows search hits as one list, in the order the server ranked them', () => {
    const groups = groupThreads({
      threads: [thread({ id: 'a' }), thread({ id: 'b', pinned: true })],
      isSearching: true,
    });

    expect(groups).toEqual([
      { key: 'results', threads: [expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'b' })] },
    ]);
  });

  it('has no groups for no threads', () => {
    expect(groupThreads({ threads: [], isSearching: false })).toEqual([]);
    expect(groupThreads({ threads: [], isSearching: true })).toEqual([]);
  });
});
