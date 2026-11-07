import type { ChatMessageStatus } from './messages';

/** The user's answer to a clarification card. It travels in the message body, so it works for read-only users too. */
export interface ChatClarificationAnswerInput {
  clarificationId: string;
  optionIds: string[];
  freeText?: string;
}

/**
 * Body of `POST /chat/threads/:id/messages`. `text` may be empty only when the message carries an
 * attachment or a clarification answer.
 */
export interface ChatSendMessageRequest {
  text: string;
  attachmentIds?: string[];
  clarificationAnswer?: ChatClarificationAnswerInput;
}

/** The 202 answer to a sent message: the run executes detached, its events stream from `/chat/runs/:runId/events`. */
export interface ChatSendMessageResponse {
  runId: string;
  /** The assistant message the run fills. */
  messageId: string;
  userMessageId: string;
}

/** The answer to a cancel request. `status` is still `streaming` while the run winds down. */
export interface ChatCancelRunResponse {
  runId: string;
  status: ChatMessageStatus;
}

/** Model steps per message. */
export const CHAT_MAX_STEPS = 25;
/** Tool calls per message, on every runner. */
export const CHAT_MAX_TOOL_CALLS = 60;
/** Proposed cards per message. */
export const CHAT_MAX_PROPOSALS = 100;
/** Third-party read calls per message. */
export const CHAT_MAX_THIRD_PARTY_READS = 10;
/** Sandbox analyses per message. */
export const CHAT_MAX_ANALYSES = 5;
/** Rows `run_analysis` collects from one paged read, across all its pages. */
export const CHAT_ANALYSIS_MAX_ROWS = 5_000;
/** Named inputs one analysis takes. */
export const CHAT_ANALYSIS_MAX_INPUTS = 5;
/** Characters of one read result sent to the model; the full result stays available for the run. */
export const CHAT_READ_RESULT_MAX_CHARS = 40_000;
/** Wall time of one run. */
export const CHAT_RUN_MAX_MS = 10 * 60 * 1000;
/** Concurrent runs: one per thread (409), three per user (429). */
export const CHAT_MAX_RUNS_PER_THREAD = 1;
export const CHAT_MAX_RUNS_PER_USER = 3;

/** Sandbox bounds for `run_analysis` (Phase 3). */
export const CHAT_SANDBOX_LIMITS = {
  memoryBytes: 64 * 1024 * 1024,
  stackBytes: 512 * 1024,
  cpuMs: 2_000,
  wallMs: 5_000,
  codeBytes: 20 * 1024,
  inputBytes: 8 * 1024 * 1024,
  outputBytes: 256 * 1024,
} as const;

/** Bounds of a clarification card, whose question and option labels are the only model text on a card. */
export const CHAT_CLARIFICATION_LIMITS = {
  questionMaxChars: 300,
  maxOptions: 8,
  optionLabelMaxChars: 80,
  freeTextMaxChars: 500,
} as const;
