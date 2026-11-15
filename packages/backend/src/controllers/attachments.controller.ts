import { ATTACHMENT_FILENAME_HEADER } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import {
  deleteAttachment,
  getAttachmentFile,
  listAttachments,
  uploadAttachment,
} from '@services/attachments/attachments.service';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';

const transactionParams = z.object({ params: z.object({ transactionId: recordId() }) });
const attachmentParams = z.object({ params: z.object({ id: recordId() }) });

/** Header value is percent-encoded by the client; a malformed one falls back to the raw string. */
export const readFilename = ({ value }: { value: string | undefined }): string => {
  if (!value) return 'attachment';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const uploadAttachmentController = createController(transactionParams, async ({ user, params, req }) => {
  const body: unknown = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new ValidationError({ message: t({ key: 'attachments.noFileUploaded' }) });
  }

  const data = await uploadAttachment({
    userId: user.id,
    transactionId: params.transactionId,
    filename: readFilename({ value: req.get(ATTACHMENT_FILENAME_HEADER) }),
    bytes: body,
  });

  return { data, statusCode: 201 };
});

export const listAttachmentsController = createController(transactionParams, async ({ user, params }) => {
  const data = await listAttachments({ userId: user.id, transactionId: params.transactionId });
  return { data };
});

export const getAttachmentFileController = createController(attachmentParams, async ({ user, params, res }) => {
  const { attachment, stream } = await getAttachmentFile({ userId: user.id, id: params.id });

  res.setHeader('Content-Type', attachment.mimeType);
  res.setHeader('Content-Length', String(attachment.size));
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  // Commits the headers, so the controller factory sees `res.headersSent` and leaves
  // the streamed body alone even if the source stream dies mid-transfer.
  res.flushHeaders();

  await pipeline(stream, res).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
    logger.error(
      { message: 'Attachment download stream failed', error },
      { code: 'ATTACHMENT_DOWNLOAD_STREAM_FAILED', attachmentId: params.id },
    );
    res.destroy();
  });
});

export const deleteAttachmentController = createController(attachmentParams, async ({ user, params }) => {
  await deleteAttachment({ userId: user.id, id: params.id });
});
