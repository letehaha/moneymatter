import type { ChatMessagePart } from './messages';
import type { ChatProposalCard } from './proposals';
import type { ChatUsage } from './threads';

export type ChatRunStatus = 'complete' | 'cancelled' | 'failed' | 'stepLimit' | 'interrupted';

/**
 * One event of a run's replayable stream. On the wire the SSE `event:` is `type`, the `id:` is the
 * Redis Stream id and `data:` is the JSON of the event without `type`. Heartbeats are comments.
 */
export type ChatRunEvent =
  | { type: 'run.started'; runId: string; messageId: string; provider: string; modelId: string }
  | { type: 'part.started'; part: ChatMessagePart }
  | { type: 'text.delta'; partId: string; delta: string }
  /** The run made its first card: the live view drops these text parts, as a reload does. */
  | { type: 'text.retracted'; partIds: string[] }
  | { type: 'part.updated'; partId: string; patch: Record<string, unknown> }
  | { type: 'proposal.upserted'; card: ChatProposalCard }
  | ({ type: 'usage' } & ChatUsage)
  | { type: 'run.finished'; status: ChatRunStatus; error?: { code: string; messageKey: string } };

export type ChatRunEventType = ChatRunEvent['type'];

/** Payload of the global SSE `chat_thread_updated` event: other tabs refresh their thread lists. */
export interface ChatThreadUpdatedPayload {
  threadId: string;
}
