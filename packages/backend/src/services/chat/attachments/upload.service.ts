import {
  CHAT_ATTACHMENT_MAX_BYTES,
  type ChatAttachment,
  type ChatAttachmentKind,
  type RecordId,
  type StatementFileType,
} from '@bt/shared/types';
import { t } from '@i18n/index';
import { PayloadTooLargeError, ValidationError } from '@js/errors';
import ChatAttachments from '@models/chat-attachments.model';
import { sanitizeFilename } from '@services/attachments/attachments.service';
import { findThreadOrThrow } from '@services/chat/threads/find-thread';
import {
  prepareStatementContent,
  resolveTextExtractionSuggestion,
  validateFileBuffer,
} from '@services/import-export/statement-parser';
import { createHash } from 'node:crypto';

import { capAttachmentText } from './attachment-text';
import { toChatAttachment } from './to-chat-attachment';

const BYTES_PER_MEGABYTE = 1024 * 1024;

/** The statement parser calls a plain-text file `txt`; the chat calls it `text`. */
const KIND_BY_FILE_TYPE = { image: 'image', pdf: 'pdf', csv: 'csv', txt: 'text' } as const satisfies Record<
  string,
  ChatAttachmentKind
>;

const documentMimeType = ({ fileType }: { fileType: StatementFileType }): string => {
  if (fileType === 'pdf') return 'application/pdf';
  return fileType === 'csv' ? 'text/csv' : 'text/plain';
};

/**
 * Reads one uploaded file into what a chat turn can use and stores it on the thread, unsent. The file
 * itself is not kept: a document is stored as its capped text and an image as its bytes. The same bytes
 * uploaded again while still unsent answer the attachment already waiting, so a double click or a
 * retried request cannot stack copies.
 *
 * Every refusal is a client error: the statement parser's own failures (a password the PDF needs, a
 * scan with no text) are answered as 422 with its message, never as a server fault.
 */
export const uploadChatAttachment = async ({
  userId,
  threadId,
  fileName,
  bytes,
  password,
}: {
  userId: number;
  threadId: RecordId;
  fileName: string;
  bytes: Buffer;
  password?: string;
}): Promise<ChatAttachment> => {
  await findThreadOrThrow({ userId, threadId });

  const validation = validateFileBuffer({ buffer: bytes, allowImages: true });
  if (!validation.valid) {
    if (validation.error.code === 'FILE_TOO_LARGE') {
      throw new PayloadTooLargeError({
        message: t({
          key: 'chat.fileTooLarge',
          variables: { maxMegabytes: CHAT_ATTACHMENT_MAX_BYTES / BYTES_PER_MEGABYTE },
        }),
      });
    }
    // UNSUPPORTED_TYPE and INVALID_FILE.
    throw new ValidationError({ message: validation.error.message });
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const waiting = await ChatAttachments.findOne({
    where: { threadId, userId, messageId: null, sha256 },
    attributes: { exclude: ['imageData'] },
  });
  if (waiting) return toChatAttachment({ attachment: waiting });

  const prepared = await prepareStatementContent({ buffer: bytes, password });
  if (!prepared.success) {
    throw new ValidationError({
      message: resolveTextExtractionSuggestion({
        fileType: prepared.fileType,
        errorCode: prepared.textResult.errorCode,
      }),
    });
  }

  const { content, fileType, pageCount } = prepared;
  const kind = KIND_BY_FILE_TYPE[fileType];
  const attachment = await ChatAttachments.create({
    threadId,
    messageId: null,
    userId,
    fileName: sanitizeFilename({ filename: fileName }),
    mimeType: content.kind === 'image' ? content.mediaType : documentMimeType({ fileType }),
    kind,
    sizeBytes: bytes.length,
    sha256,
    extractedText: content.kind === 'text' ? capAttachmentText({ text: content.text }) : null,
    pageCount,
    imageData: content.kind === 'image' ? content.image : null,
  });

  return toChatAttachment({ attachment });
};
