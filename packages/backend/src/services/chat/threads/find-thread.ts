import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import ChatThreads from '@models/chat-threads.model';

/** The caller's own thread. Another user's thread answers the same 404 as a missing one. */
export const findThreadOrThrow = ({
  userId,
  threadId,
  lock = false,
}: {
  userId: number;
  threadId: string;
  /** Row lock for the rest of the transaction; needs an ambient transaction. */
  lock?: boolean;
}): Promise<ChatThreads> =>
  findOrThrowNotFound({
    query: ChatThreads.findOne({ where: { id: threadId, userId }, ...(lock ? { lock: true } : {}) }),
    message: t({ key: 'chat.threadNotFound' }),
  });
