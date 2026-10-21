import type { ChatEntityKind, ChatEntityRef } from './fields';
import type { ChatProposalCard } from './proposals';
import type { ChatThread, ChatUsage } from './threads';
import type { ChatVisualSpec } from './visuals';

export type ChatMessageRole = 'user' | 'assistant';

export type ChatMessageStatus = 'complete' | 'streaming' | 'cancelled' | 'failed' | 'interrupted' | 'stepLimit';

export type ChatAttachmentKind = 'image' | 'pdf' | 'csv' | 'text';

/** The page the panel was opened on; the composer shows it as a removable chip. */
export interface ChatPageContext {
  /** Route name. */
  route?: string;
  /** The entity the page is about. */
  entity?: ChatEntityRef;
  /** The entity in an open drawer or dialog; it is what "this" means while it is open. */
  focus?: ChatEntityRef;
  /** The rows ticked on the page: their kind, the first ids and how many there are in all. */
  selection?: { kind: ChatEntityKind; ids: string[]; total?: number };
  filters?: Record<string, unknown>;
  period?: { from: string; to: string };
}

export interface ChatMessageError {
  code: string;
  messageKey: string;
}

export type ChatNoticeParams = Record<string, string | number>;

/** The part types both roles share. */
export interface ChatTextPart {
  type: 'text';
  id: string;
  text: string;
}

export interface ChatAttachmentPart {
  type: 'attachment';
  id: string;
  attachmentId: string;
  /** What the attachment is, so a message shows a thumbnail or a named chip; absent from messages sent earlier. */
  fileName?: string;
  mimeType?: string;
  kind?: ChatAttachmentKind;
}

/** User parts. */
export interface ChatPageContextPart {
  type: 'pageContext';
  id: string;
  context: ChatPageContext;
}

export interface ChatClarificationAnswerPart {
  type: 'clarificationAnswer';
  id: string;
  clarificationId: string;
  optionIds: string[];
  freeText?: string;
}

export interface ChatCardCommentPart {
  type: 'cardComment';
  id: string;
  proposalId: string;
  text: string;
}

/** Assistant parts. */
export interface ChatToolCallPart {
  type: 'toolCall';
  id: string;
  callId: string;
  toolName: string;
  args: unknown;
  status: 'running' | 'ok' | 'error';
  resultSummary?: string;
  error?: string;
  durationMs?: number;
}

export interface ChatProposalPart {
  type: 'proposal';
  id: string;
  proposalId: string;
}

export interface ChatClarificationOption {
  id: string;
  label: string;
}

export interface ChatClarificationPart {
  type: 'clarification';
  id: string;
  question: string;
  options: ChatClarificationOption[];
  allowFreeText: boolean;
  multiSelect: boolean;
  answer?: { optionIds: string[]; freeText?: string };
}

export interface ChatVisualPart {
  type: 'visual';
  id: string;
  spec: ChatVisualSpec;
}

/**
 * Where an analysis input came from: an earlier call of the run, or a catalog read the server ran
 * (`allPages`: every page of it, up to the row cap, joined into one result).
 */
export type ChatAnalysisInputSource =
  | { fromCall: string }
  | { tool: string; args: Record<string, unknown>; allPages?: boolean };

export interface ChatAnalysisPart {
  type: 'analysis';
  id: string;
  code: string;
  inputs: Array<{ name: string; source: ChatAnalysisInputSource }>;
  status: 'running' | 'ok' | 'error';
  output?: unknown;
  error?: string;
  durationMs?: number;
}

/** A server-made line: step limit, tool-call or proposal cap, cancelled, interrupted. */
export interface ChatNoticePart {
  type: 'notice';
  id: string;
  key: string;
  params: ChatNoticeParams;
}

export interface ChatErrorPart {
  type: 'error';
  id: string;
  code: string;
  messageKey: string;
}

export type ChatUserPart =
  | ChatTextPart
  | ChatAttachmentPart
  | ChatPageContextPart
  | ChatClarificationAnswerPart
  | ChatCardCommentPart;

export type ChatAssistantPart =
  | ChatTextPart
  | ChatAttachmentPart
  | ChatToolCallPart
  | ChatProposalPart
  | ChatClarificationPart
  | ChatVisualPart
  | ChatAnalysisPart
  | ChatNoticePart
  | ChatErrorPart;

/** What `ChatMessages.parts` stores: the ordered parts of one message. */
export type ChatMessagePart = ChatUserPart | ChatAssistantPart;

export interface ChatMessage {
  id: string;
  threadId: string;
  role: ChatMessageRole;
  status: ChatMessageStatus;
  parts: ChatMessagePart[];
  plainText: string | null;
  pageContext: ChatPageContext | null;
  runId: string | null;
  provider: string | null;
  modelId: string | null;
  promptVersion: string | null;
  usage: ChatUsage | null;
  stepCount: number;
  error: ChatMessageError | null;
  createdAt: string;
}

/**
 * A thread with a page of its messages, oldest first. `hasMore` says older messages exist before the
 * first one. `cards` holds, by id, the current card of every `proposal` part on the page.
 */
export interface ChatThreadWithMessages {
  thread: ChatThread;
  messages: ChatMessage[];
  hasMore: boolean;
  cards: Record<string, ChatProposalCard>;
}

/** Characters of one user message. */
export const CHAT_MESSAGE_MAX_CHARS = 8_000;
