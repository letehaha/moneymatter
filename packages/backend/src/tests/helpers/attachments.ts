import {
  ATTACHMENT_FILENAME_HEADER,
  ATTACHMENT_UPLOAD_TOKEN_HEADER,
  type TransactionAttachmentModel,
} from '@bt/shared/types';
import { app } from '@root/app';
import { API_PREFIX } from '@root/config';
import type { listAttachments as apiListAttachments } from '@services/attachments/attachments.service';
import request from 'supertest';

import { makeRequest } from './common';

const bufferParser = (res: NodeJS.ReadableStream, callback: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

export interface UploadAttachmentResult {
  statusCode: number;
  response: TransactionAttachmentModel | null;
  errorMessage: string | null;
}

export function createAttachmentUploadToken<R extends boolean | undefined = undefined>({
  transactionId,
  raw,
}: {
  transactionId: string;
  raw?: R;
}) {
  return makeRequest<{ token: string }, R>({
    method: 'post',
    url: '/tests/attachment-upload-token',
    payload: { transactionId },
    raw,
  });
}

/** POST raw file bytes to the upload endpoint; `uploadToken` is sent in addition to any session cookie. */
export async function uploadAttachment({
  transactionId,
  file,
  filename = 'receipt.png',
  contentType = 'application/octet-stream',
  uploadToken,
}: {
  transactionId: string;
  file: Buffer;
  filename?: string;
  contentType?: string;
  uploadToken?: string;
}): Promise<UploadAttachmentResult> {
  const base = request(app)
    .post(`${API_PREFIX}/transactions/${transactionId}/attachments`)
    .set('Content-Type', contentType)
    .set(ATTACHMENT_FILENAME_HEADER, encodeURIComponent(filename));
  if (global.APP_AUTH_COOKIES) base.set('Cookie', global.APP_AUTH_COOKIES);
  if (uploadToken) base.set(ATTACHMENT_UPLOAD_TOKEN_HEADER, uploadToken);

  const result = await base.send(file);
  const body = result.body as { response?: TransactionAttachmentModel & { message?: string } };
  return {
    statusCode: result.status,
    response: result.status === 201 ? (body.response ?? null) : null,
    errorMessage: result.status === 201 ? null : (body.response?.message ?? null),
  };
}

export function listAttachments<R extends boolean | undefined = undefined>({
  transactionId,
  raw,
}: {
  transactionId: string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof apiListAttachments>>, R>({
    method: 'get',
    url: `/transactions/${transactionId}/attachments`,
    raw,
  });
}

export interface DownloadAttachmentResult {
  statusCode: number;
  body: Buffer;
  contentType: string | null;
  contentDisposition: string | null;
  nosniff: string | null;
}

export async function downloadBinary({ url }: { url: string }) {
  const base = request(app).get(`${API_PREFIX}${url}`);
  if (global.APP_AUTH_COOKIES) base.set('Cookie', global.APP_AUTH_COOKIES);

  const result = await base.buffer(true).parse(bufferParser);
  const header = ({ name }: { name: string }) => (result.headers[name] as string | undefined) ?? null;
  return { statusCode: result.status, body: result.body as Buffer, header };
}

export async function downloadAttachment({ id }: { id: string }): Promise<DownloadAttachmentResult> {
  const { statusCode, body, header } = await downloadBinary({ url: `/attachments/${id}/file` });
  return {
    statusCode,
    body,
    contentType: header({ name: 'content-type' }),
    contentDisposition: header({ name: 'content-disposition' }),
    nosniff: header({ name: 'x-content-type-options' }),
  };
}

export function deleteAttachment({ id }: { id: string }) {
  return makeRequest({ method: 'delete', url: `/attachments/${id}` });
}
