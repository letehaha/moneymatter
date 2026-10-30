import { app } from '@root/app';
import { API_PREFIX } from '@root/config';
import type { matchInvoice as apiMatchInvoice } from '@services/invoice-matching/match-invoice.service';
import request from 'supertest';

import { followBackgroundJob, makeRequest } from './common';

type MatchInvoiceResponse = Awaited<ReturnType<typeof apiMatchInvoice>>;

export interface MatchInvoiceResult {
  statusCode: number;
  response: MatchInvoiceResponse | null;
  errorMessage: string | null;
}

/** POSTs raw invoice bytes the way the frontend uploads them. */
export async function matchInvoice({
  file,
  transactionType,
  contentType = 'application/octet-stream',
}: {
  file: Buffer;
  transactionType?: string;
  contentType?: string;
}): Promise<MatchInvoiceResult> {
  const base = request(app)
    .post(`${API_PREFIX}/transactions/match-invoice`)
    .query(transactionType ? { transactionType } : {})
    .set('Content-Type', contentType);
  if (global.APP_AUTH_COOKIES) base.set('Cookie', global.APP_AUTH_COOKIES);

  const result = await followBackgroundJob({ response: await base.send(file) });
  const body = result.body as { response?: MatchInvoiceResponse & { message?: string } };

  return {
    statusCode: result.status,
    response: result.status === 200 ? (body.response ?? null) : null,
    errorMessage: result.status === 200 ? null : (body.response?.message ?? null),
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
