import type { ChatMessage, ChatPageContext, ChatThread } from '@bt/shared/types';
import type ChatMessages from '@models/chat-messages.model';

/** The columns of a `ChatThreads` row that the API shows; a model instance and a raw query row both fit. */
export interface ChatThreadRow {
  id: string;
  title: string;
  titleSource: ChatThread['titleSource'];
  pinned: boolean;
  lastMessageAt: Date | string;
  expiresAt: Date | string | null;
  connectionId: string | null;
  modelId: string | null;
  pageContext: ChatPageContext | null;
  inputTokens: string | number;
  outputTokens: string | number;
  cachedInputTokens: string | number;
  createdAt: Date | string;
}

const toIso = ({ value }: { value: Date | string }): string => new Date(value).toISOString();

export const toChatThread = ({ row }: { row: ChatThreadRow }): ChatThread => ({
  id: row.id,
  title: row.title,
  titleSource: row.titleSource,
  pinned: row.pinned,
  lastMessageAt: toIso({ value: row.lastMessageAt }),
  expiresAt: row.expiresAt === null ? null : toIso({ value: row.expiresAt }),
  usage: {
    // BIGINT comes back from Postgres as a string.
    inputTokens: Number(row.inputTokens),
    outputTokens: Number(row.outputTokens),
    cachedInputTokens: Number(row.cachedInputTokens),
  },
  connectionId: row.connectionId,
  modelId: row.modelId,
  pageContext: row.pageContext ?? null,
  // Filled by `withPageContextNames`, which looks the names up for a whole page of threads.
  pageContextNames: {},
  createdAt: toIso({ value: row.createdAt }),
});

export const toChatMessage = ({ row }: { row: ChatMessages }): ChatMessage => ({
  id: row.id,
  threadId: row.threadId,
  role: row.role,
  status: row.status,
  parts: row.parts,
  plainText: row.plainText,
  pageContext: row.pageContext,
  runId: row.runId,
  provider: row.provider,
  modelId: row.modelId,
  promptVersion: row.promptVersion,
  usage: row.usage,
  stepCount: row.stepCount,
  error: row.error,
  createdAt: row.createdAt.toISOString(),
});
