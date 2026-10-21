import type { ChatPageContext, ChatThread } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import ChatThreads from '@models/chat-threads.model';
import { withTransaction } from '@services/common/with-transaction';

import { getChatRetentionDays } from './retention.service';
import {
  type ThreadModelChoice,
  assertSelectableConnection,
  pickDefaultThreadChoice,
  resolveThreadModel,
} from './thread-connection';
import { notifyThreadUpdated } from './thread-events';
import { computeThreadExpiry } from './thread-expiry';
import { normalizeThreadPageContext, withPageContextNames } from './thread-page-context';
import { toChatThread } from './to-chat-thread';

interface CreateThreadParams {
  userId: number;
  title?: string;
  /** Omitted: the thread starts on the connection and model `pickDefaultThreadChoice` names. Null picks the included model. */
  connectionId?: string | null;
  /**
   * A model of the named connection. Null asks for the connection's own model outright, where omitted
   * lets a thread that inherits its connection inherit the model too. A model needs `connectionId`.
   */
  modelId?: string | null;
  /** The page the conversation starts on. */
  pageContext?: ChatPageContext | null;
}

const createThreadImpl = async ({
  userId,
  title,
  connectionId,
  modelId,
  pageContext,
}: Pick<CreateThreadParams, 'userId' | 'title'> &
  ThreadModelChoice & { pageContext: ChatPageContext | null }): Promise<ChatThread> => {
  const retentionDays = await getChatRetentionDays({ userId, lock: true });
  const lastMessageAt = new Date();

  const thread = await ChatThreads.create({
    userId,
    // An untitled thread is shown with a localized placeholder until its first message names it.
    title: title ?? '',
    titleSource: title === undefined ? 'auto' : 'user',
    pinned: false,
    connectionId,
    modelId,
    pageContext,
    lastMessageAt,
    expiresAt: computeThreadExpiry({ lastMessageAt, pinned: false, retentionDays }),
  });

  return toChatThread({ row: thread });
};

const createThreadTransactional = withTransaction(createThreadImpl);

export const createThread = async (params: CreateThreadParams): Promise<ChatThread> => {
  const { userId } = params;
  let choice: ThreadModelChoice;

  if (params.connectionId === undefined) {
    // A model names a connection's model, so it can't ride on a connection picked for the user.
    if (params.modelId) throw new ValidationError({ message: t({ key: 'chat.modelNeedsConnection' }) });
    choice = await pickDefaultThreadChoice({ userId });
    // An explicit null keeps the inherited connection but not its model.
    if (params.modelId === null) choice = { connectionId: choice.connectionId, modelId: null };
  } else {
    await assertSelectableConnection({ userId, connectionId: params.connectionId });
    choice = {
      connectionId: params.connectionId,
      modelId: await resolveThreadModel({
        userId,
        connectionId: params.connectionId,
        modelId: params.modelId ?? null,
      }),
    };
  }

  const pageContext = await normalizeThreadPageContext({ userId, context: params.pageContext });
  const created = await createThreadTransactional({ userId, title: params.title, pageContext, ...choice });
  const thread = (await withPageContextNames({ userId, threads: [created] }))[0]!;
  notifyThreadUpdated({ userId, threadId: thread.id });
  return thread;
};
