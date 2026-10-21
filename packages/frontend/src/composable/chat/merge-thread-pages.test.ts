import type { ChatMessage, ChatProposalCard } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { joinsLatestPage, mergeThreadPages } from './merge-thread-pages';

const message = (id: string) => ({ id }) as ChatMessage;
const card = (id: string, status: ChatProposalCard['status'] = 'pending') => ({ id, status }) as ChatProposalCard;
const page = ({
  ids,
  cards = [],
  hasMore = false,
}: {
  ids: string[];
  cards?: ChatProposalCard[];
  hasMore?: boolean;
}) => ({
  messages: ids.map(message),
  cards: Object.fromEntries(cards.map((item) => [item.id, item])),
  hasMore,
});

describe('mergeThreadPages', () => {
  it('is the latest page when nothing older is loaded', () => {
    const latest = page({ ids: ['3', '4'], cards: [card('a')], hasMore: true });

    const merged = mergeThreadPages({ latest, older: [] });

    expect(merged.messages.map((item) => item.id)).toEqual(['3', '4']);
    expect(Object.keys(merged.cards)).toEqual(['a']);
    expect(merged.hasMore).toBe(true);
  });

  it('puts older pages in front, oldest first, whatever order they were loaded in', () => {
    const merged = mergeThreadPages({
      latest: page({ ids: ['5', '6'], hasMore: true }),
      older: [page({ ids: ['3', '4'], hasMore: true }), page({ ids: ['1', '2'], hasMore: false })],
    });

    expect(merged.messages.map((item) => item.id)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(merged.hasMore).toBe(false);
  });

  it('shows a message that two pages share once, from the newest page', () => {
    const merged = mergeThreadPages({
      latest: page({ ids: ['4', '5'] }),
      older: [page({ ids: ['3', '4'], hasMore: true })],
    });

    expect(merged.messages.map((item) => item.id)).toEqual(['3', '4', '5']);
  });

  it('lets the newest page win for a card held by several pages', () => {
    const merged = mergeThreadPages({
      latest: page({ ids: ['2'], cards: [card('a', 'applied')] }),
      older: [page({ ids: ['1'], cards: [card('a', 'pending'), card('b')] })],
    });

    expect(merged.cards.a!.status).toBe('applied');
    expect(Object.keys(merged.cards).toSorted()).toEqual(['a', 'b']);
  });
});

describe('joinsLatestPage', () => {
  it('holds while the message that opened the latest page is still on it', () => {
    expect(joinsLatestPage({ anchorId: '3', latest: page({ ids: ['2', '3', '4'] }) })).toBe(true);
  });

  it('fails once the latest page has slid past that message', () => {
    expect(joinsLatestPage({ anchorId: '3', latest: page({ ids: ['5', '6'] }) })).toBe(false);
  });
});
