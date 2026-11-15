import { AI_FEATURE } from '@bt/shared/types';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import ChatThreads from '@models/chat-threads.model';
import { createAIClient } from '@services/ai';
import type { AIClientResult } from '@services/ai/ai-client-factory';
import { resolveAIConfiguration } from '@services/ai/ai-model-resolver';
import { withTransaction } from '@services/common/with-transaction';
import { assertConnectionServesModel, getStoredAiSettings } from '@services/user-settings/ai-connections';

import { findThreadOrThrow } from './find-thread';

const getConnections = async ({ userId }: { userId: number }) =>
  (await getStoredAiSettings({ userId }))?.connections ?? [];

/**
 * Throws unless the user's chat may run on `connectionId`: one of their own connections, or null for the
 * included model where one serves chat.
 */
export async function assertSelectableConnection({
  userId,
  connectionId,
}: {
  userId: number;
  connectionId: string | null;
}): Promise<void> {
  if (connectionId === null) {
    const resolution = await resolveAIConfiguration({ userId, feature: AI_FEATURE.chat, pinnedConnectionId: null });
    if (resolution?.kind !== 'server') {
      throw new ValidationError({ message: t({ key: 'chat.includedModelUnavailable' }) });
    }
    return;
  }

  // Another user's connection id is not in this user's settings, so it answers like a missing one.
  const connection = (await getConnections({ userId })).find((candidate) => candidate.id === connectionId);
  if (!connection) throw new NotFoundError({ message: t({ key: 'ai.connectionNotFound' }) });
}

/**
 * Checks that a thread on `connectionId` may run `modelId`, and returns what the thread stores: the model,
 * or null for the connection's own model (a null request, or the connection's default named outright).
 * The included model has no choice of model.
 */
export async function resolveThreadModel({
  userId,
  connectionId,
  modelId,
}: {
  userId: number;
  connectionId: string | null;
  modelId: string | null;
}): Promise<string | null> {
  if (modelId === null) return null;

  if (connectionId === null) {
    throw new ValidationError({ message: t({ key: 'ai.includedModelHasNoChoice' }) });
  }

  return assertConnectionServesModel({ userId, connectionId, modelId });
}

/** A connection a new thread may inherit: it exists and is not flagged down. */
async function isInheritable({ userId, connectionId }: { userId: number; connectionId: string }): Promise<boolean> {
  const connection = (await getConnections({ userId })).find((candidate) => candidate.id === connectionId);
  if (!connection || connection.status === 'invalid') return false;

  return true;
}

export interface ThreadModelChoice {
  connectionId: string | null;
  /** Null: the connection's own model. */
  modelId: string | null;
}

/**
 * What a new thread starts on: the connection and model the user's most recently used thread has, while
 * the connection is still usable; else the connection that answers by default, on its own model; else the
 * included model where one serves chat. A null connection means nothing can answer yet.
 */
export async function pickDefaultThreadChoice({ userId }: { userId: number }): Promise<ThreadModelChoice> {
  const latest = await ChatThreads.findOne({
    where: { userId },
    order: [
      ['lastMessageAt', 'DESC'],
      ['id', 'DESC'],
    ],
    attributes: ['connectionId', 'modelId'],
  });

  if (latest?.connectionId && (await isInheritable({ userId, connectionId: latest.connectionId }))) {
    return { connectionId: latest.connectionId, modelId: latest.modelId };
  }

  const resolution = await resolveAIConfiguration({ userId, feature: AI_FEATURE.chat });

  return { connectionId: resolution?.kind === 'connection' ? resolution.connectionId : null, modelId: null };
}

/** The thread's connection and model, read under the row lock so a switch that is still being written is waited for. */
const readThreadChoice = withTransaction(
  async ({ userId, threadId }: { userId: number; threadId: string }): Promise<ThreadModelChoice> => {
    const { connectionId, modelId } = await findThreadOrThrow({ userId, threadId, lock: true });
    return { connectionId, modelId };
  },
);

/**
 * The AI client for a thread's next run, built on the thread's connection and model. A connection deleted
 * since the thread picked it falls back as for a new thread. When the client that answers is not the one the
 * thread names (the fallback, or a connection that could not be dialled), the thread keeps the one that
 * answers, on that connection's own model. A model the provider no longer serves is not replaced: the run
 * fails on it.
 */
export async function createThreadAiClient({
  userId,
  threadId,
}: {
  userId: number;
  threadId: string;
}): Promise<AIClientResult | null> {
  const stored = await readThreadChoice({ userId, threadId });
  const deleted =
    stored.connectionId !== null &&
    !(await getConnections({ userId })).some((candidate) => candidate.id === stored.connectionId);
  const pinned = deleted ? await pickDefaultThreadChoice({ userId }) : stored;

  const aiClient = await createAIClient({
    userId,
    feature: AI_FEATURE.chat,
    pinnedConnectionId: pinned.connectionId,
    pinnedModelId: pinned.modelId,
  });

  if (aiClient) {
    const answering: ThreadModelChoice = {
      connectionId: aiClient.connectionId ?? null,
      modelId: aiClient.modelOverridden ? pinned.modelId : null,
    };

    if (answering.connectionId !== stored.connectionId || answering.modelId !== stored.modelId) {
      await ChatThreads.update(answering, { where: { id: threadId, userId } });
    }
  }

  return aiClient;
}
