import type { ChatMessagePart, ChatProposalCard, ChatRunEvent, ChatRunStatus, ChatUsage } from '@bt/shared/types';

/** What a live run has produced so far, built from its events. */
export interface ChatRunState {
  runId: string;
  messageId: string;
  provider: string | null;
  modelId: string | null;
  status: 'streaming' | ChatRunStatus;
  parts: ChatMessagePart[];
  /** Cards the run proposed or changed, by id. */
  cards: Record<string, ChatProposalCard>;
  usage: ChatUsage;
  error: { code: string; messageKey: string } | null;
}

export const createRunState = ({ runId, messageId }: { runId: string; messageId: string }): ChatRunState => ({
  runId,
  messageId,
  provider: null,
  modelId: null,
  status: 'streaming',
  parts: [],
  cards: {},
  usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
  error: null,
});

const upsertPart = ({ parts, part }: { parts: ChatMessagePart[]; part: ChatMessagePart }): ChatMessagePart[] =>
  parts.some((existing) => existing.id === part.id)
    ? parts.map((existing) => (existing.id === part.id ? part : existing))
    : [...parts, part];

const mapPart = ({
  parts,
  partId,
  update,
}: {
  parts: ChatMessagePart[];
  partId: string;
  update: (part: ChatMessagePart) => ChatMessagePart;
}): ChatMessagePart[] => parts.map((part) => (part.id === partId ? update(part) : part));

/**
 * The state after one more event. It mirrors the server's recorder (`run-recorder.ts`), so the live
 * view and the message the server stores agree. The state it is given is never changed; a delta for a
 * part that is not there, or a patch for one, is dropped.
 */
export const applyRunEvent = ({ state, event }: { state: ChatRunState; event: ChatRunEvent }): ChatRunState => {
  switch (event.type) {
    case 'run.started':
      return { ...state, provider: event.provider, modelId: event.modelId };
    case 'part.started':
      return { ...state, parts: upsertPart({ parts: state.parts, part: event.part }) };
    case 'text.delta':
      return {
        ...state,
        parts: mapPart({
          parts: state.parts,
          partId: event.partId,
          update: (part) => (part.type === 'text' ? { ...part, text: part.text + event.delta } : part),
        }),
      };
    case 'text.retracted': {
      const retracted = new Set(event.partIds);
      return { ...state, parts: state.parts.filter((part) => !retracted.has(part.id)) };
    }
    case 'part.updated':
      return {
        ...state,
        parts: mapPart({
          parts: state.parts,
          partId: event.partId,
          update: (part) => ({ ...part, ...event.patch }) as ChatMessagePart,
        }),
      };
    case 'proposal.upserted':
      return { ...state, cards: { ...state.cards, [event.card.id]: event.card } };
    case 'usage':
      return {
        ...state,
        usage: {
          inputTokens: state.usage.inputTokens + event.inputTokens,
          outputTokens: state.usage.outputTokens + event.outputTokens,
          cachedInputTokens: state.usage.cachedInputTokens + event.cachedInputTokens,
        },
      };
    case 'run.finished':
      return { ...state, status: event.status, error: event.error ?? null };
    default:
      return state;
  }
};
