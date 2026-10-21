import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES, type ChatProposalCard, type ChatThreadWithMessages } from '@bt/shared/types';
import { QueryClient } from '@tanstack/vue-query';
import { describe, expect, it } from 'vitest';

import { cardsFromActionError, patchChatCardsInCache } from './chat-cards-cache';

const card = ({
  id,
  status = 'pending',
  revision = 1,
}: {
  id: string;
  status?: ChatProposalCard['status'];
  revision?: number;
}) => ({ id, status, revision }) as ChatProposalCard;

const page = ({ cards }: { cards: ChatProposalCard[] }) =>
  ({
    thread: { id: 'thread-1' },
    messages: [],
    hasMore: false,
    cards: Object.fromEntries(cards.map((item) => [item.id, item])),
  }) as unknown as ChatThreadWithMessages;

describe('patchChatCardsInCache', () => {
  it('replaces a card in every cached page of every thread that holds it', () => {
    const queryClient = new QueryClient();
    const latestKey = [...VUE_QUERY_CACHE_KEYS.chatThread, 'thread-1'];
    const olderKey = [...VUE_QUERY_CACHE_KEYS.chatThread, 'thread-1', 'before', 'm1'];
    queryClient.setQueryData(latestKey, page({ cards: [card({ id: 'a' }), card({ id: 'b' })] }));
    queryClient.setQueryData(olderKey, page({ cards: [card({ id: 'a' })] }));

    patchChatCardsInCache({ queryClient, cards: [card({ id: 'a', status: 'applied', revision: 2 })] });

    expect(queryClient.getQueryData<ChatThreadWithMessages>(latestKey)!.cards.a).toMatchObject({
      status: 'applied',
      revision: 2,
    });
    expect(queryClient.getQueryData<ChatThreadWithMessages>(olderKey)!.cards.a).toMatchObject({ status: 'applied' });
    expect(queryClient.getQueryData<ChatThreadWithMessages>(latestKey)!.cards.b).toMatchObject({ status: 'pending' });
  });

  it('leaves cards a page does not hold out of it', () => {
    const queryClient = new QueryClient();
    const key = [...VUE_QUERY_CACHE_KEYS.chatThread, 'thread-1'];
    queryClient.setQueryData(key, page({ cards: [card({ id: 'a' })] }));

    patchChatCardsInCache({ queryClient, cards: [card({ id: 'elsewhere', status: 'applied' })] });

    expect(Object.keys(queryClient.getQueryData<ChatThreadWithMessages>(key)!.cards)).toEqual(['a']);
  });

  it('does not touch queries of other kinds or empty ones', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(VUE_QUERY_CACHE_KEYS.chatThreads, { threads: [], nextCursor: null });

    patchChatCardsInCache({ queryClient, cards: [card({ id: 'a' })] });

    expect(queryClient.getQueryData(VUE_QUERY_CACHE_KEYS.chatThreads)).toEqual({ threads: [], nextCursor: null });
  });
});

describe('cardsFromActionError', () => {
  const conflict = ({ details }: { details?: Record<string, unknown> }) =>
    new ApiErrorResponseError('conflict', { code: API_ERROR_CODES.conflict, message: 'conflict', details });

  it('reads the cards a 409 or 422 answer carries', () => {
    const cards = cardsFromActionError({
      error: conflict({
        details: { reason: 'revision', card: card({ id: 'a' }), cards: [card({ id: 'a' }), card({ id: 'b' })] },
      }),
    });

    expect(cards.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('falls back to the single card when there is no chain', () => {
    expect(
      cardsFromActionError({ error: conflict({ details: { reason: 'expired', card: card({ id: 'a' }) } }) }),
    ).toHaveLength(1);
  });

  it('reads nothing from other errors', () => {
    expect(cardsFromActionError({ error: new Error('network') })).toEqual([]);
    expect(cardsFromActionError({ error: conflict({}) })).toEqual([]);
  });
});
