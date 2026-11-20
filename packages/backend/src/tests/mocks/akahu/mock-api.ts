import type { AkahuApiTransactionsResponse } from '@services/bank-data-providers/akahu/types';
import { HttpResponse, http } from 'msw';

import { getMockedAkahuAccount, getMockedAkahuAccounts, getMockedAkahuMe, getMockedAkahuTransactions } from './data';

export const VALID_AKAHU_USER_TOKEN = 'valid-akahu-user-token-12345';
export const VALID_AKAHU_APP_TOKEN = 'valid-akahu-app-token-67890';
export const INVALID_AKAHU_USER_TOKEN = 'invalid-akahu-user-token';

export const AKAHU_BASE_URL = 'https://api.akahu.io/v1';

const isAuthed = (request: Request): boolean =>
  request.headers.get('authorization') === `Bearer ${VALID_AKAHU_USER_TOKEN}` &&
  request.headers.get('x-akahu-id') === VALID_AKAHU_APP_TOKEN;

const unauthorized = () =>
  new HttpResponse(JSON.stringify({ success: false, message: 'Permission Denied' }), {
    status: 401,
    statusText: 'Unauthorized',
  });

const TRANSACTIONS_URL = new RegExp(`${AKAHU_BASE_URL}/accounts/acc_[a-z0-9]+/transactions`);

// Honors `start` (exclusive), `end` (inclusive) and an offset `cursor`, like Akahu's paging.
const respondWithTransactions = ({
  request,
  response,
  pageSize = 100,
}: {
  request: Request;
  response: AkahuApiTransactionsResponse;
  pageSize?: number;
}) => {
  if (!isAuthed(request)) return unauthorized();

  const params = new URL(request.url).searchParams;
  const start = params.get('start');
  const end = params.get('end');
  const offset = Number(params.get('cursor') ?? 0);

  const items = response.items.filter(
    (tx) => (!start || new Date(tx.date) > new Date(start)) && (!end || new Date(tx.date) <= new Date(end)),
  );
  const next = offset + pageSize < items.length ? String(offset + pageSize) : null;

  return HttpResponse.json({ ...response, items: items.slice(offset, offset + pageSize), cursor: { next } });
};

export const getAkahuTransactionsMock = ({
  response,
  accountId,
  pageSize,
  onRequest,
}: {
  response?: AkahuApiTransactionsResponse;
  accountId?: string;
  pageSize?: number;
  onRequest?: (params: URLSearchParams) => void;
}) =>
  http.get(accountId ? `${AKAHU_BASE_URL}/accounts/${accountId}/transactions` : TRANSACTIONS_URL, ({ request }) => {
    onRequest?.(new URL(request.url).searchParams);
    return respondWithTransactions({ request, response: response ?? getMockedAkahuTransactions(), pageSize });
  });

export const akahuHandlers = [
  http.get(`${AKAHU_BASE_URL}/me`, ({ request }) => {
    if (!isAuthed(request)) return unauthorized();
    return HttpResponse.json(getMockedAkahuMe());
  }),

  http.get(`${AKAHU_BASE_URL}/accounts`, ({ request }) => {
    if (!isAuthed(request)) return unauthorized();
    return HttpResponse.json(getMockedAkahuAccounts());
  }),

  http.post(new RegExp(`${AKAHU_BASE_URL}/refresh/acc_[a-z0-9]+$`), ({ request }) => {
    if (!isAuthed(request)) return unauthorized();
    return HttpResponse.json({ success: true });
  }),

  http.get(new RegExp(`${AKAHU_BASE_URL}/accounts/acc_[a-z0-9]+$`), ({ request }) => {
    if (!isAuthed(request)) return unauthorized();
    const path = new URL(request.url).pathname;
    const accountId = path.slice(path.lastIndexOf('/') + 1);
    return HttpResponse.json({ success: true, item: getMockedAkahuAccount({ accountId }) });
  }),

  http.get(TRANSACTIONS_URL, ({ request }) => {
    const accountId = new URL(request.url).pathname.split('/')[3];
    return respondWithTransactions({ request, response: getMockedAkahuTransactions({ accountId }) });
  }),
];
