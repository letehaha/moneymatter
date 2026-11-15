import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { ApiErrorResponseError } from '@/js/errors';
import type { ChatCardConflictDetails, ChatProposalCard, ChatThreadWithMessages } from '@bt/shared/types';
import type { QueryClient } from '@tanstack/vue-query';

/**
 * Replaces each card in every cached thread page that holds it: the latest page and any older page
 * of any thread. A page that does not hold a card is left alone (a card not on the page is not
 * added), so a page keeps showing exactly the cards its messages point to.
 */
export const patchChatCardsInCache = ({
  queryClient,
  cards,
}: {
  queryClient: QueryClient;
  cards: ChatProposalCard[];
}): void => {
  if (cards.length === 0) return;

  queryClient.setQueriesData<ChatThreadWithMessages>({ queryKey: VUE_QUERY_CACHE_KEYS.chatThread }, (page) => {
    if (!page?.cards) return page;

    const held = cards.filter((card) => card.id in page.cards);
    if (held.length === 0) return page;

    return { ...page, cards: { ...page.cards, ...Object.fromEntries(held.map((card) => [card.id, card])) } };
  });
};

/**
 * The cards a refused card action answers with: a 409 or 422 carries the card as it is now and every
 * card of its chain, so the client can show the truth instead of its stale copy.
 */
export const cardsFromActionError = ({ error }: { error: unknown }): ChatProposalCard[] => {
  if (!(error instanceof ApiErrorResponseError)) return [];

  const details = error.data?.details as Partial<ChatCardConflictDetails> | undefined;
  if (details?.cards?.length) return details.cards;
  return details?.card ? [details.card] : [];
};
