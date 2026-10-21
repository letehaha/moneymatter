import type { ChatThreadWithMessages } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import ChatMessages from '@models/chat-messages.model';
import { Op, type WhereOptions } from 'sequelize';

import { findThreadOrThrow } from './find-thread';
import { withPageContextNames } from './thread-page-context';
import { toChatMessage, toChatThread } from './to-chat-thread';

/**
 * A thread with one page of its messages, oldest first. Without `before` the page is the latest
 * `limit` messages; with it, the `limit` messages just before that message. The page carries the
 * cards its proposal parts point to, so a client reads a conversation in one request.
 */
export const getThread = async ({
  userId,
  threadId,
  before,
  limit,
}: {
  userId: number;
  threadId: string;
  before?: string;
  limit: number;
}): Promise<ChatThreadWithMessages> => {
  const thread = await findThreadOrThrow({ userId, threadId });

  let where: WhereOptions = { threadId };
  if (before) {
    const anchor = await findOrThrowNotFound({
      query: ChatMessages.findOne({ where: { id: before, threadId } }),
      message: t({ key: 'chat.messageNotFound' }),
    });
    where = {
      threadId,
      [Op.or]: [
        { createdAt: { [Op.lt]: anchor.createdAt } },
        { createdAt: anchor.createdAt, id: { [Op.lt]: anchor.id } },
      ],
    };
  }

  const newestFirst = await ChatMessages.findAll({
    where,
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    limit: limit + 1,
  });

  const messages = newestFirst
    .slice(0, limit)
    .toReversed()
    .map((row) => toChatMessage({ row }));

  return {
    thread: (await withPageContextNames({ userId, threads: [toChatThread({ row: thread })] }))[0]!,
    messages,
    hasMore: newestFirst.length > limit,
    cards: {},
  };
};
