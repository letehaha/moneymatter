import type { RecordId } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import ChatAttachments from '@models/chat-attachments.model';

/**
 * The caller's own attachment. Another user's attachment answers the same 404 as a missing one.
 * The bytes of an image stay out of the row unless `withImage` asks for them.
 */
export const findChatAttachmentOrThrow = ({
  userId,
  attachmentId,
  withImage = false,
}: {
  userId: number;
  attachmentId: RecordId;
  withImage?: boolean;
}): Promise<ChatAttachments> =>
  findOrThrowNotFound({
    query: ChatAttachments.findOne({
      where: { id: attachmentId, userId },
      ...(withImage ? {} : { attributes: { exclude: ['imageData'] } }),
    }),
    message: t({ key: 'chat.attachmentNotFound' }),
  });
