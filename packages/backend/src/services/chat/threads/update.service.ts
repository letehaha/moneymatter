import type { ChatPageContext, ChatThread } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ConflictError } from '@js/errors';
import { withTransaction } from '@services/common/with-transaction';

import { findThreadOrThrow } from './find-thread';
import { getChatRetentionDays } from './retention.service';
import { assertSelectableConnection, resolveThreadModel } from './thread-connection';
import { notifyThreadUpdated } from './thread-events';
import { computeThreadExpiry } from './thread-expiry';
import { normalizeThreadPageContext, withPageContextNames } from './thread-page-context';
import { toChatThread } from './to-chat-thread';

interface UpdateThreadParams {
  userId: number;
  threadId: string;
  title?: string;
  pinned?: boolean;
  /** A connection of the user, or null for the included model; it takes effect on the next message. */
  connectionId?: string | null;
  /** A model of the thread's connection, or null for its own model. A switch of connection resets it first. */
  modelId?: string | null;
  /** Replaces the thread's page, or removes it with null. */
  pageContext?: ChatPageContext | null;
}

/** What was checked with the provider before the transaction: the connection the model was checked on. */
interface CheckedSelection {
  /** The connection the thread ends up on. */
  connectionId: string | null;
  /** The model to store, or undefined when the request did not name one. */
  modelId: string | null | undefined;
}

/** The thread's connection moved between the check and the lock, so the checked model may not fit it. */
class StaleSelectionError extends Error {}

const updateThreadImpl = async (
  { userId, threadId, title, pinned, connectionId, modelId, pageContext }: UpdateThreadParams,
  checked: CheckedSelection,
): Promise<ChatThread> => {
  // Settings before thread, the order `setChatRetention` locks in.
  const retentionDays = pinned === undefined ? null : await getChatRetentionDays({ userId, lock: true });
  const thread = await findThreadOrThrow({ userId, threadId, lock: true });

  if (title !== undefined) {
    thread.title = title;
    thread.titleSource = 'user';
  }

  if (pinned !== undefined) {
    thread.pinned = pinned;
    thread.expiresAt = computeThreadExpiry({ lastMessageAt: thread.lastMessageAt, pinned, retentionDays });
  }

  const switchesConnection = connectionId !== undefined && connectionId !== thread.connectionId;

  // The model was checked against the connection the thread had then, so a move since makes it stale.
  if (modelId !== undefined && (switchesConnection ? connectionId : thread.connectionId) !== checked.connectionId) {
    throw new StaleSelectionError();
  }

  if (connectionId !== undefined && switchesConnection) {
    thread.connectionId = connectionId;
    // A model belongs to its connection: the new one starts on its own model unless the request names one.
    thread.modelId = null;
  }

  if (checked.modelId !== undefined) thread.modelId = checked.modelId;
  // A page is only context for the next message, so a run in flight does not stop it from changing.
  if (pageContext !== undefined) thread.pageContext = pageContext;

  await thread.save();

  return toChatThread({ row: thread });
};

const updateThreadTransactional = withTransaction(updateThreadImpl);

/**
 * Asks the provider about a model pick before the transaction, so the thread row, the settings row and a
 * pooled connection are not held across a call that can take seconds. A switch or pick while a run is
 * active is refused first, so a refused request costs no provider call.
 */
const checkSelection = async (params: UpdateThreadParams): Promise<CheckedSelection> => {
  const { userId, threadId, connectionId, modelId } = params;
  const thread = await findThreadOrThrow({ userId, threadId });

  const switchesConnection = connectionId !== undefined && connectionId !== thread.connectionId;

  const targetConnectionId = connectionId !== undefined ? connectionId : thread.connectionId;
  if (connectionId !== undefined && switchesConnection) {
    await assertSelectableConnection({ userId, connectionId });
  }

  return {
    connectionId: targetConnectionId,
    modelId:
      modelId === undefined
        ? undefined
        : await resolveThreadModel({ userId, connectionId: targetConnectionId, modelId }),
  };
};

const normalizeContext = async ({ userId, pageContext }: UpdateThreadParams) =>
  pageContext === undefined ? undefined : normalizeThreadPageContext({ userId, context: pageContext });

export const updateThread = async (params: UpdateThreadParams): Promise<ChatThread> => {
  const hasSelection = params.connectionId !== undefined || params.modelId !== undefined;
  let thread: ChatThread | undefined;

  // One retry covers a connection switch landing between the check and the lock; a second one is a real race.
  for (let attempt = 0; thread === undefined; attempt++) {
    const checked: CheckedSelection = hasSelection
      ? await checkSelection(params)
      : { connectionId: null, modelId: undefined };

    try {
      thread = await updateThreadTransactional({ ...params, pageContext: await normalizeContext(params) }, checked);
    } catch (error) {
      if (!(error instanceof StaleSelectionError)) throw error;
      if (attempt > 0) throw new ConflictError({ message: t({ key: 'chat.runInProgress' }) });
    }
  }

  notifyThreadUpdated({ userId: params.userId, threadId: thread.id });
  return (await withPageContextNames({ userId: params.userId, threads: [thread] }))[0]!;
};
