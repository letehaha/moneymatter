import type { RecordId } from '@bt/shared/types';
import { t } from '@i18n/index';
import { NotFoundError } from '@js/errors';

import { findChatAttachmentOrThrow } from './read.service';

/** The stored bytes of an image attachment and the content type they were identified as. */
export const getChatAttachmentImage = async ({
  userId,
  attachmentId,
}: {
  userId: number;
  attachmentId: RecordId;
}): Promise<{ bytes: Buffer; mimeType: string; fileName: string }> => {
  const attachment = await findChatAttachmentOrThrow({ userId, attachmentId, withImage: true });

  // A document has no image to serve; it answers like a missing attachment.
  if (attachment.kind !== 'image' || !attachment.imageData) {
    throw new NotFoundError({ message: t({ key: 'chat.attachmentNotFound' }) });
  }

  return { bytes: attachment.imageData, mimeType: attachment.mimeType, fileName: attachment.fileName };
};
