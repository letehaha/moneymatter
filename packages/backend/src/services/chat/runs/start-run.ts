import {
  CHAT_ATTACHMENT_TEXT_MAX_CHARS_PER_MESSAGE,
  CHAT_ATTACHMENTS_MAX_BYTES_PER_MESSAGE,
  type ChatClarificationAnswerInput,
  type ChatAttachmentKind,
  type ChatClarificationPart,
  type ChatSendMessageResponse,
  type ChatUserPart,
} from '@bt/shared/types';
import { t } from '@i18n/index';
import { ConflictError, NotFoundError, TooManyRequests, ValidationError } from '@js/errors';
import ChatAttachments from '@models/chat-attachments.model';
import ChatMessages from '@models/chat-messages.model';
import { connection } from '@models/index';
import { describeMissingAiConfiguration } from '@services/ai/connection-failure';
import { withTransaction } from '@services/common/with-transaction';
import { randomUUID } from 'node:crypto';
import { QueryTypes, col, fn } from 'sequelize';

import { CHAT_PROMPT_VERSION } from '../prompt/system-prompt';
import { runAiSdkChat } from '../runners/ai-sdk-runner';
import { findThreadOrThrow } from '../threads/find-thread';
import { createThreadAiClient } from '../threads/thread-connection';
import { notifyThreadUpdated } from '../threads/thread-events';
import { deriveThreadTitle } from '../threads/thread-title';
import { touchThread } from '../threads/touch-thread';
import { acquireRunSlots, releaseRunSlots, startRunLease } from './run-lease';
import { launchChatRun } from './run-manager';

interface SendableAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  kind: ChatAttachmentKind;
}

/**
 * The attachments a message may carry: the caller's, in this thread, not yet sent with another
 * message, and within the per-message bounds on bytes and extracted text.
 */
async function loadSendableAttachments({
  userId,
  threadId,
  attachmentIds,
}: {
  userId: number;
  threadId: string;
  attachmentIds: string[];
}): Promise<SendableAttachment[]> {
  const ids = [...new Set(attachmentIds)];
  if (ids.length === 0) return [];

  const rows = (await ChatAttachments.findAll({
    where: { id: ids, userId, threadId, messageId: null },
    attributes: [
      'id',
      'fileName',
      'mimeType',
      'kind',
      'sizeBytes',
      [fn('char_length', fn('coalesce', col('extractedText'), '')), 'textLength'],
    ],
    raw: true,
  })) as unknown as Array<SendableAttachment & { sizeBytes: number; textLength: number | string }>;

  if (rows.length !== ids.length) throw new NotFoundError({ message: t({ key: 'chat.attachmentNotFound' }) });

  const totalBytes = rows.reduce((sum, row) => sum + Number(row.sizeBytes), 0);
  if (totalBytes > CHAT_ATTACHMENTS_MAX_BYTES_PER_MESSAGE) {
    throw new ValidationError({ message: t({ key: 'chat.attachmentsTooLarge' }) });
  }
  const totalText = rows.reduce((sum, row) => sum + Number(row.textLength), 0);
  if (totalText > CHAT_ATTACHMENT_TEXT_MAX_CHARS_PER_MESSAGE) {
    throw new ValidationError({ message: t({ key: 'chat.attachmentsTextTooLong' }) });
  }

  return ids
    .map((id) => rows.find((row) => row.id === id)!)
    .map(({ id, fileName, mimeType, kind }) => ({ id, fileName, mimeType, kind }));
}

/**
 * Records the user's answer on the clarification it answers (in the assistant message that asked) and
 * returns the text to store for the answer: the labels of the chosen options, or the free text.
 */
async function recordClarificationAnswer({
  threadId,
  answer,
}: {
  threadId: string;
  answer: ChatClarificationAnswerInput;
}): Promise<string> {
  const [holderRow] = (await connection.sequelize.query(
    `SELECT id FROM "ChatMessages"
     WHERE "threadId" = $threadId AND role = 'assistant' AND parts @> $match::jsonb
     LIMIT 1`,
    {
      bind: { threadId, match: JSON.stringify([{ type: 'clarification', id: answer.clarificationId }]) },
      type: QueryTypes.SELECT,
    },
  )) as Array<{ id: string }>;
  const holder = holderRow ? await ChatMessages.findByPk(holderRow.id, { lock: true }) : null;
  const part = holder?.parts.find(
    (candidate): candidate is ChatClarificationPart =>
      candidate.type === 'clarification' && candidate.id === answer.clarificationId,
  );
  if (!holder || !part) throw new NotFoundError({ message: t({ key: 'chat.clarificationNotFound' }) });
  if (part.answer) throw new ConflictError({ message: t({ key: 'chat.clarificationAnswered' }) });

  const chosen = answer.optionIds.map((id) => part.options.find((option) => option.id === id));
  const freeText = answer.freeText?.trim();
  const invalid =
    chosen.some((option) => !option) ||
    (chosen.length > 1 && !part.multiSelect) ||
    (freeText && !part.allowFreeText) ||
    (chosen.length === 0 && !freeText);
  if (invalid) throw new ValidationError({ message: t({ key: 'chat.clarificationAnswerInvalid' }) });

  holder.parts = holder.parts.map((candidate) =>
    candidate === part
      ? { ...part, answer: { optionIds: answer.optionIds, ...(freeText ? { freeText } : {}) } }
      : candidate,
  );
  holder.changed('parts', true);
  await holder.save();

  return [...chosen.map((option) => option!.label), ...(freeText ? [freeText] : [])].join(', ');
}

/**
 * The user's message and the empty assistant message the run will fill, written together with the
 * thread's new `lastMessageAt`, expiry and (for an untitled thread) title, and the attachments
 * linked to the message.
 */
const createRunMessages = withTransaction(
  async ({
    userId,
    threadId,
    runId,
    text,
    attachments,
    clarificationAnswer,
    cardComment,
    provider,
    modelId,
  }: {
    userId: number;
    threadId: string;
    runId: string;
    text: string;
    attachments: SendableAttachment[];
    clarificationAnswer: ChatClarificationAnswerInput | undefined;
    cardComment: { proposalId: string } | undefined;
    provider: string;
    modelId: string;
  }) => {
    const answerText = clarificationAnswer
      ? await recordClarificationAnswer({ threadId, answer: clarificationAnswer })
      : '';

    const parts: ChatUserPart[] = [
      // A comment on a card carries its text in the comment part, so the history shows it once.
      ...(text && !cardComment ? [{ type: 'text' as const, id: randomUUID(), text }] : []),
      ...(cardComment
        ? [{ type: 'cardComment' as const, id: randomUUID(), proposalId: cardComment.proposalId, text }]
        : []),
      // The name and kind travel with the part, so the history shows a thumbnail or a named chip without a lookup.
      ...attachments.map(({ id, fileName, mimeType, kind }) => ({
        type: 'attachment' as const,
        id: randomUUID(),
        attachmentId: id,
        fileName,
        mimeType,
        kind,
      })),
      ...(clarificationAnswer
        ? [
            {
              type: 'clarificationAnswer' as const,
              id: randomUUID(),
              clarificationId: clarificationAnswer.clarificationId,
              optionIds: clarificationAnswer.optionIds,
              ...(clarificationAnswer.freeText?.trim() ? { freeText: clarificationAnswer.freeText.trim() } : {}),
            },
          ]
        : []),
    ];

    // The assistant message is stamped a millisecond later, so the pair always sorts user first.
    const now = Date.now();
    const userMessage = await ChatMessages.create({
      threadId,
      userId,
      role: 'user',
      status: 'complete',
      parts,
      plainText: text || answerText || null,
      createdAt: new Date(now),
    });
    const assistantMessage = await ChatMessages.create({
      threadId,
      userId,
      role: 'assistant',
      status: 'streaming',
      parts: [],
      runId,
      provider,
      modelId,
      promptVersion: CHAT_PROMPT_VERSION,
      createdAt: new Date(now + 1),
    });

    if (attachments.length > 0) {
      await ChatAttachments.update(
        { messageId: userMessage.id },
        { where: { id: attachments.map(({ id }) => id), userId, threadId, messageId: null } },
      );
    }

    await touchThread({
      userId,
      threadId,
      title: deriveThreadTitle({
        text: text || answerText,
        attachmentNames: attachments.map(({ fileName }) => fileName),
      }),
    });

    return { userMessageId: userMessage.id, assistantMessageId: assistantMessage.id };
  },
);

/**
 * `POST /chat/threads/:id/messages`: checks the request, claims the run slots, stores the user's
 * message and the empty assistant message, and starts the run detached. The answer is the run id; the
 * run's events stream from `GET /chat/runs/:runId/events`.
 */
export async function startChatRun({
  user,
  threadId,
  text,
  attachmentIds,
  clarificationAnswer,
  cardComment,
}: {
  user: { id: number };
  threadId: string;
  text: string;
  attachmentIds: string[];
  clarificationAnswer?: ChatClarificationAnswerInput;
  /** Set when the message is a comment on a card: the card it is about. */
  cardComment?: { proposalId: string };
}): Promise<ChatSendMessageResponse> {
  await findThreadOrThrow({ userId: user.id, threadId });
  const attachments = await loadSendableAttachments({ userId: user.id, threadId, attachmentIds });

  const runId = randomUUID();
  const slots = await acquireRunSlots({ userId: user.id, threadId, runId });
  if (slots === 'threadBusy') throw new ConflictError({ message: t({ key: 'chat.runInProgress' }) });
  if (slots === 'userBusy') throw new TooManyRequests({ message: t({ key: 'chat.tooManyRuns' }) });

  // The lease exists before the message does, so the sweep never sees a streaming message without one.
  const lease = await startRunLease({ runId, userId: user.id, threadId }).catch(async (error) => {
    await releaseRunSlots({ userId: user.id, threadId, runId });
    throw error;
  });

  try {
    // Resolved once the run holds its slot: a switch of the thread's connection is refused while the slot
    // is taken, and the read waits for one that is still being written, so the run starts on what the thread shows.
    const aiClient = await createThreadAiClient({ userId: user.id, threadId });
    if (!aiClient) throw new ValidationError({ message: await describeMissingAiConfiguration({ userId: user.id }) });
    const runner = runAiSdkChat;

    const { userMessageId, assistantMessageId } = await createRunMessages({
      userId: user.id,
      threadId,
      runId,
      text,
      attachments,
      clarificationAnswer,
      cardComment,
      provider: aiClient.provider,
      modelId: aiClient.modelId,
    });

    launchChatRun({
      runId,
      messageId: assistantMessageId,
      userMessageId,
      threadId,
      userId: user.id,
      aiClient,
      runner,
      lease,
    });
    notifyThreadUpdated({ userId: user.id, threadId });

    return { runId, messageId: assistantMessageId, userMessageId };
  } catch (error) {
    await Promise.allSettled([lease.stop(), releaseRunSlots({ userId: user.id, threadId, runId })]);
    throw error;
  }
}
