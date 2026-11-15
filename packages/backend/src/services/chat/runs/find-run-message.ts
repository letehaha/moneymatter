import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import ChatMessages from '@models/chat-messages.model';

/**
 * The assistant message of a run, if the run is the caller's. Another user's run answers the same 404
 * as one that never existed.
 */
export const findRunMessage = ({ userId, runId }: { userId: number; runId: string }): Promise<ChatMessages> =>
  findOrThrowNotFound({
    query: ChatMessages.findOne({
      where: { runId, userId, role: 'assistant' },
      attributes: ['id', 'threadId', 'userId', 'runId', 'status', 'error'],
    }),
    message: t({ key: 'chat.runNotFound' }),
  });
