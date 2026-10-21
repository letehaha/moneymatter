import type { ChatMessage, ChatProposalCard, ChatThreadWithMessages } from '@bt/shared/types';

interface MergedThread {
  messages: ChatMessage[];
  cards: Record<string, ChatProposalCard>;
  /** Messages older than the oldest one shown exist. */
  hasMore: boolean;
}

/**
 * The latest page together with the older pages loaded behind it (nearest first), as one
 * conversation, oldest message first. A message found twice is shown once, from the newest page.
 */
export const mergeThreadPages = ({
  latest,
  older,
}: {
  latest: Pick<ChatThreadWithMessages, 'messages' | 'cards' | 'hasMore'>;
  older: Array<Pick<ChatThreadWithMessages, 'messages' | 'cards' | 'hasMore'>>;
}): MergedThread => {
  const pagesOldestFirst = [...older].reverse();
  const seen = new Set(latest.messages.map((message) => message.id));
  const messages: ChatMessage[] = [];

  for (const page of pagesOldestFirst) {
    for (const message of page.messages) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      messages.push(message);
    }
  }
  messages.push(...latest.messages);

  return {
    messages,
    cards: Object.assign({}, ...pagesOldestFirst.map((page) => page.cards), latest.cards),
    hasMore: pagesOldestFirst.length > 0 ? pagesOldestFirst[0]!.hasMore : latest.hasMore,
  };
};

/**
 * Whether the older pages still join the latest one. The first older page was read before the message
 * that opened the latest page then (`anchorId`); once the latest page has slid past that message, the
 * messages in between are in neither page, and the older pages are better dropped than shown with a hole.
 */
export const joinsLatestPage = ({
  anchorId,
  latest,
}: {
  anchorId: string;
  latest: Pick<ChatThreadWithMessages, 'messages'>;
}): boolean => latest.messages.some((message) => message.id === anchorId);
