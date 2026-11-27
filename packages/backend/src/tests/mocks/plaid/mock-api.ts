import type { PlaidAccount, PlaidTransaction } from '@services/bank-data-providers/plaid/api-client';
import { HttpResponse, http } from 'msw';

import { checking, credit, PLAID_ACCESS_TOKEN, PLAID_ITEM_ID } from './data';

export const PLAID_BASE_URL = 'https://sandbox.plaid.com';

export const page = ({
  cursor,
  added = [],
  modified = [],
  removed = [],
  hasMore = false,
}: {
  cursor: string;
  added?: PlaidTransaction[];
  modified?: PlaidTransaction[];
  removed?: { transaction_id: string; account_id?: string }[];
  hasMore?: boolean;
}) => HttpResponse.json({ added, modified, removed, next_cursor: cursor, has_more: hasMore });
type SyncRequest = { cursor?: string; options?: unknown; access_token: string };

export const mockProvider = () => {
  const exchanges: unknown[] = [];
  const links: Record<string, unknown>[] = [];
  const syncRequests: SyncRequest[] = [];
  const removals: unknown[] = [];
  const accountRequests: unknown[] = [];
  let accounts: PlaidAccount[] | undefined;
  const state = {
    get accounts() {
      return (accounts ??= [checking(), credit()]);
    },
    set accounts(value: PlaidAccount[]) {
      accounts = value;
    },
    exchangeResult: { access_token: PLAID_ACCESS_TOKEN, item_id: PLAID_ITEM_ID },
    loginRequired: false,
    sync: (_: SyncRequest): Response => page({ cursor: 'initial' }),
    exchanges,
    links,
    removals,
    accountRequests,
    syncRequests,
  };
  const handlers = [
    http.post(`${PLAID_BASE_URL}/link/token/create`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      links.push(body);
      return HttpResponse.json({ link_token: body.access_token ? 'link-sandbox-update' : 'link-sandbox-new' });
    }),
    http.post(`${PLAID_BASE_URL}/item/public_token/exchange`, async ({ request }) => {
      exchanges.push(await request.json());
      return HttpResponse.json(state.exchangeResult);
    }),
    http.post(`${PLAID_BASE_URL}/item/get`, () =>
      HttpResponse.json({
        item: { item_id: PLAID_ITEM_ID, error: state.loginRequired ? { error_code: 'ITEM_LOGIN_REQUIRED' } : null },
      }),
    ),
    http.post(`${PLAID_BASE_URL}/accounts/get`, async ({ request }) => {
      accountRequests.push(await request.json());
      return state.loginRequired
        ? HttpResponse.json(
            { error_code: 'ITEM_LOGIN_REQUIRED', error_message: `sensitive ${PLAID_ACCESS_TOKEN}` },
            { status: 400 },
          )
        : HttpResponse.json({ accounts: state.accounts });
    }),
    http.post(`${PLAID_BASE_URL}/item/remove`, async ({ request }) => {
      removals.push(await request.json());
      return HttpResponse.json({ removed: true });
    }),
    http.post(`${PLAID_BASE_URL}/transactions/sync`, async ({ request }) => {
      const body = (await request.json()) as SyncRequest;
      syncRequests.push(body);
      return state.sync(body);
    }),
  ];
  return { state, handlers };
};

export const plaidHandlers = mockProvider().handlers;
