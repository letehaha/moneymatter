import type { ChatRunEvent, ChatTextPart } from '@bt/shared/types';

export interface ChatTextPolicy {
  /** Feeds one piece of assistant text; both runners call it with their own stream's text. */
  delta: (params: { partId: string; delta: string }) => Promise<void>;
  /** The run made a proposal or a clarification: retract the text so far and drop what follows. */
  cardCreated: () => Promise<void>;
  hasCard: () => boolean;
  /** The text to persist: everything the run wrote when it made no card, nothing when it did. */
  persistedTextParts: () => ChatTextPart[];
}

/**
 * The one rule for assistant text in an acting turn, shared by the runners. Text streams live; the
 * first card of the run retracts every text part streamed so far and silences the rest, so a live
 * view and a reload show the same thing: the cards and the visuals, no prose.
 */
export function createTextPolicy({ emit }: { emit: (event: ChatRunEvent) => void | Promise<void> }): ChatTextPolicy {
  const parts = new Map<string, ChatTextPart>();
  let hasCard = false;

  return {
    delta: async ({ partId, delta }) => {
      if (hasCard) return;

      let part = parts.get(partId);
      if (!part) {
        part = { type: 'text', id: partId, text: '' };
        parts.set(partId, part);
        await emit({ type: 'part.started', part: { ...part } });
      }

      part.text += delta;
      await emit({ type: 'text.delta', partId, delta });
    },

    cardCreated: async () => {
      if (hasCard) return;
      hasCard = true;

      if (parts.size > 0) await emit({ type: 'text.retracted', partIds: [...parts.keys()] });
    },

    hasCard: () => hasCard,

    persistedTextParts: () => (hasCard ? [] : [...parts.values()].map((part) => ({ ...part }))),
  };
}
