import {
  ATTACHMENTS_MAX_PER_TRANSACTION,
  ATTACHMENT_QUOTA_BYTES,
  ATTACHMENT_UPLOAD_TOKEN_TTL_SECONDS,
  type AttachmentMimeType,
  SHARE_PERMISSIONS,
  type SharePermission,
} from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { isSelfHost } from '@config/is-self-host';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import TransactionAttachments from '@models/transaction-attachments.model';
import { redisClient } from '@root/redis-client';
import { getTransactionById } from '@services/transactions/get-by-id';
import { createHash, randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { v7 as uuidv7 } from 'uuid';

import { deleteObject, getObjectStream, putObject, storageKey } from './storage';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Content type comes from the bytes only — a client-supplied header would let SVG/HTML through. */
export const detectMimeType = ({ bytes }: { bytes: Buffer }): AttachmentMimeType | null => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(PNG_MAGIC)) return 'image/png';
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
};

export const sanitizeFilename = ({ filename }: { filename: string }): string => {
  const cleaned = filename
    .replace(/[/\\]/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
    .slice(0, 255);
  return cleaned || 'attachment';
};

/** Resolves share-aware access to the parent transaction; not-accessible is indistinguishable from not-found. */
const authorizeTransaction = async ({
  userId,
  transactionId,
  permission,
}: {
  userId: number;
  transactionId: string;
  permission: SharePermission;
}) => {
  const found = await findOrThrowNotFound({
    query: getTransactionById({ id: transactionId, userId, requiredPermission: permission }),
    message: t({ key: 'attachments.transactionNotFound' }),
  });
  return found.tx;
};

const findAuthorizedAttachment = async ({
  userId,
  id,
  permission,
}: {
  userId: number;
  id: string;
  permission: SharePermission;
}) => {
  const attachment = await findOrThrowNotFound({
    query: TransactionAttachments.findByPk(id),
    message: t({ key: 'attachments.attachmentNotFound' }),
  });
  await authorizeTransaction({ userId, transactionId: attachment.transactionId, permission });
  return attachment;
};

/** Only the hash is stored, so a Redis dump never yields a usable token. */
const uploadTokenKey = ({ token }: { token: string }) =>
  `attachment-upload-token:${createHash('sha256').update(token).digest('base64url')}`;

export const createAttachmentUploadToken = async ({
  userId,
  transactionId,
}: {
  userId: number;
  transactionId: string;
}): Promise<string> => {
  await authorizeTransaction({ userId, transactionId, permission: SHARE_PERMISSIONS.write });

  // Redis is the only store for the token, so a failed write must fail the mint:
  // `CacheClient` swallows write errors and would hand back a token that never resolves.
  const token = randomBytes(32).toString('base64url');
  await redisClient.setex(
    uploadTokenKey({ token }),
    ATTACHMENT_UPLOAD_TOKEN_TTL_SECONDS,
    JSON.stringify({ userId, transactionId }),
  );
  return token;
};

/** Returns the owning user id, or null when the token is unknown, expired, or minted for another transaction. */
export const resolveAttachmentUploadToken = async ({
  token,
  transactionId,
}: {
  token: string;
  transactionId: string;
}): Promise<number | null> => {
  const stored = await redisClient.get(uploadTokenKey({ token }));
  if (!stored) return null;

  const entry = JSON.parse(stored) as { userId: number; transactionId: string };
  return entry.transactionId === transactionId ? entry.userId : null;
};

export const uploadAttachment = async ({
  userId,
  transactionId,
  filename,
  bytes,
}: {
  userId: number;
  transactionId: string;
  filename: string;
  bytes: Buffer;
}): Promise<TransactionAttachments> => {
  await authorizeTransaction({ userId, transactionId, permission: SHARE_PERMISSIONS.write });

  const mimeType = detectMimeType({ bytes });
  if (!mimeType) {
    throw new ValidationError({ message: t({ key: 'attachments.unsupportedFileType' }) });
  }

  const existingCount = await TransactionAttachments.count({ where: { transactionId } });
  if (existingCount >= ATTACHMENTS_MAX_PER_TRANSACTION) {
    throw new ValidationError({
      message: t({ key: 'attachments.tooManyAttachments', variables: { max: ATTACHMENTS_MAX_PER_TRANSACTION } }),
    });
  }

  if (!isSelfHost()) {
    const used = (await TransactionAttachments.sum('size', { where: { userId } })) ?? 0;
    if (used + bytes.length > ATTACHMENT_QUOTA_BYTES) {
      throw new ValidationError({ message: t({ key: 'attachments.quotaExceeded' }) });
    }
  }

  // Blob first: an orphan blob is swept by the daily cron, while a row whose blob is
  // missing is a broken attachment the user can see but never open. The id is minted
  // here rather than by the column default so the key is known before the insert.
  const id = uuidv7();
  const key = storageKey({ userId, id });
  await putObject({ key, body: bytes, contentType: mimeType });

  try {
    return await TransactionAttachments.create({
      id,
      transactionId,
      userId,
      filename: sanitizeFilename({ filename }),
      mimeType,
      size: bytes.length,
    });
  } catch (error) {
    await deleteObject({ key }).catch((cleanupError) => {
      logger.error(cleanupError as Error, { context: 'failed to remove attachment blob after a failed row insert' });
    });
    throw error;
  }
};

export const listAttachments = async ({
  userId,
  transactionId,
}: {
  userId: number;
  transactionId: string;
}): Promise<TransactionAttachments[]> => {
  await authorizeTransaction({ userId, transactionId, permission: SHARE_PERMISSIONS.read });

  return TransactionAttachments.findAll({ where: { transactionId }, order: [['createdAt', 'ASC']] });
};

export const getAttachmentFile = async ({
  userId,
  id,
}: {
  userId: number;
  id: string;
}): Promise<{ attachment: TransactionAttachments; stream: Readable }> => {
  const attachment = await findAuthorizedAttachment({ userId, id, permission: SHARE_PERMISSIONS.read });
  const stream = await getObjectStream({ key: storageKey({ userId: attachment.userId, id: attachment.id }) });
  return { attachment, stream };
};

export const deleteAttachment = async ({ userId, id }: { userId: number; id: string }): Promise<void> => {
  const attachment = await findAuthorizedAttachment({ userId, id, permission: SHARE_PERMISSIONS.write });
  const key = storageKey({ userId: attachment.userId, id: attachment.id });

  await attachment.destroy();
  await deleteObject({ key }).catch((error) => {
    logger.error(error as Error, { context: 'failed to remove attachment blob after deleting its row' });
  });
};
