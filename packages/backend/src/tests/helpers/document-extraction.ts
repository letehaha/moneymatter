import { app } from '@root/app';
import { API_PREFIX } from '@root/config';
import type { MessageExtractionResult } from '@services/document-extraction/extract-message.service';
import type { matchInvoice as apiMatchInvoice } from '@services/document-extraction/match-invoice.service';
import type { ReceiptScanResult } from '@services/document-extraction/scan-receipt.service';
import request from 'supertest';

import { followBackgroundJob, makeRequest } from './common';

type MatchInvoiceResponse = Awaited<ReturnType<typeof apiMatchInvoice>>;

export interface MatchInvoiceResult {
  statusCode: number;
  response: MatchInvoiceResponse | null;
  errorMessage: string | null;
}

interface UploadParams {
  file: Buffer;
  transactionType?: string;
  contentType?: string;
}

async function uploadDocument<T>({
  url,
  file,
  transactionType,
  contentType = 'application/octet-stream',
}: UploadParams & { url: string }): Promise<{ statusCode: number; response: T | null; errorMessage: string | null }> {
  const base = request(app)
    .post(`${API_PREFIX}${url}`)
    .query(transactionType ? { transactionType } : {})
    .set('Content-Type', contentType);
  if (global.APP_AUTH_COOKIES) base.set('Cookie', global.APP_AUTH_COOKIES);

  const result = await followBackgroundJob({ response: await base.send(file) });
  const body = result.body as { response?: T & { message?: string } };

  return {
    statusCode: result.status,
    response: result.status === 200 ? (body.response ?? null) : null,
    errorMessage: result.status === 200 ? null : (body.response?.message ?? null),
  };
}

/** POSTs raw invoice bytes the way the frontend uploads them. */
export const matchInvoice = (params: UploadParams): Promise<MatchInvoiceResult> =>
  uploadDocument<MatchInvoiceResponse>({ url: '/transactions/match-invoice', ...params });

export const extractReceipt = (params: UploadParams) =>
  uploadDocument<ReceiptScanResult>({
    url: '/transactions/extract-receipt',
    ...params,
  });

export async function extractMessage({ text }: { text: unknown }) {
  const result = await makeRequest<MessageExtractionResult & { message?: string }>({
    method: 'post',
    url: '/transactions/extract-message',
    payload: { text },
  });
  const body = result.body.response;

  return {
    statusCode: result.statusCode,
    response: result.statusCode === 200 ? body : null,
    errorMessage: result.statusCode === 200 ? null : (body?.message ?? null),
  };
}

/** Re-ranks candidates for invoice fields the user corrected; no file and no AI involved. */
export async function rematchInvoice({ invoice }: { invoice: Record<string, unknown> }): Promise<MatchInvoiceResult> {
  const result = await makeRequest<MatchInvoiceResponse & { message?: string }>({
    method: 'post',
    url: '/transactions/match-invoice/candidates',
    payload: invoice,
  });
  const body = result.body.response;

  return {
    statusCode: result.statusCode,
    response: result.statusCode === 200 ? body : null,
    errorMessage: result.statusCode === 200 ? null : (body?.message ?? null),
  };
}
