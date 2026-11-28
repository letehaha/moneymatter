import { PlaidApiClient, PlaidApiError, getPlaidConfig, readPlaidConfig } from './api-client';

const config = { clientId: 'test-client', secret: 'test-secret', environment: 'sandbox' } as const;

const json = (body: unknown, status = 200) => Response.json(body, { status });

const makeClient = (responses: Response[]) => {
  const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockImplementation(async () => {
    const response = responses.shift();
    if (!response) throw new Error('Unexpected Plaid request');
    return response;
  });
  return { client: new PlaidApiClient({ config, request }), request };
};

const tx = (id: string) => ({
  transaction_id: id,
  account_id: 'account',
  amount: 1,
  date: '2026-01-01',
  name: id,
  merchant_name: null,
  pending: false,
  iso_currency_code: 'USD',
  unofficial_currency_code: null,
});

const page = ({
  cursor,
  added = [],
  modified = [],
  removed = [],
  hasMore = false,
}: {
  cursor: string;
  added?: string[];
  modified?: string[];
  removed?: string[];
  hasMore?: boolean;
}) => ({
  next_cursor: cursor,
  has_more: hasMore,
  added: added.map(tx),
  modified: modified.map(tx),
  removed: removed.map((id) => ({ transaction_id: id })),
});

describe('Plaid configuration', () => {
  const env = {
    IS_SELF_HOST: 'true',
    PLAID_CLIENT_ID: 'id',
    PLAID_SECRET: 'secret',
    PLAID_ENV: 'sandbox',
  };

  afterEach(() => jest.restoreAllMocks());

  it.each([
    { IS_SELF_HOST: undefined },
    { PLAID_CLIENT_ID: ' ' },
    { PLAID_SECRET: undefined },
    { PLAID_ENV: 'development' },
    { PLAID_ENV: undefined },
    { PLAID_REDIRECT_URI: 'https://app.example.com/plaid-callback?query=invalid' },
  ])('does not enable Plaid for incomplete or invalid configuration: %j', (override) => {
    jest.replaceProperty(process, 'env', { ...process.env, ...env, ...override });
    expect(getPlaidConfig()).toBeNull();
  });

  it('names the failing check without exposing the secret', () => {
    jest.replaceProperty(process, 'env', { ...process.env, ...env, PLAID_ENV: 'development' });
    expect(readPlaidConfig()).toBe('PLAID_ENV must be "sandbox" or "production"');
  });

  it('accepts a configured production environment and the exact registered HTTPS redirect', () => {
    const redirectUri = 'https://app.example.com/plaid-callback';
    jest.replaceProperty(process, 'env', {
      ...process.env,
      ...env,
      PLAID_ENV: ' production ',
      PLAID_REDIRECT_URI: redirectUri,
    });
    expect(getPlaidConfig()).toEqual({
      clientId: 'id',
      secret: 'secret',
      environment: 'production',
      redirectUri,
    });
  });
});

it('creates a Sandbox Link token for Transactions with the signed-in user ID', async () => {
  const { client, request } = makeClient([json({ link_token: 'link-sandbox-example' })]);

  await expect(client.createLinkToken({ userId: 27 })).resolves.toBe('link-sandbox-example');
  const [url, options] = request.mock.calls[0] ?? [];
  expect(url).toBe('https://sandbox.plaid.com/link/token/create');
  expect(JSON.parse(String(options?.body))).toEqual({
    client_id: 'test-client',
    secret: 'test-secret',
    client_name: 'MoneyMatter',
    user: { client_user_id: '27' },
    products: ['transactions'],
    country_codes: ['US', 'CA'],
    language: 'en',
    transactions: { days_requested: 730 },
  });
});

it('combines all transaction pages and returns their final cursor', async () => {
  const { client, request } = makeClient([
    json(page({ cursor: 'second-page', added: ['a'], hasMore: true })),
    json(page({ cursor: 'done', modified: ['b'], removed: ['c'] })),
  ]);

  await expect(client.syncTransactions({ accessToken: 'access', cursor: 'start' })).resolves.toEqual({
    cursor: 'done',
    added: [tx('a')],
    modified: [tx('b')],
    removed: [{ transaction_id: 'c' }],
  });
  expect(request.mock.calls.map(([, options]) => JSON.parse(String(options?.body)).cursor)).toEqual([
    'start',
    'second-page',
  ]);
});

it('restarts from the original cursor if transactions mutate while paging', async () => {
  const { client, request } = makeClient([
    json(page({ cursor: 'stale', added: ['stale-row'], hasMore: true })),
    json({ error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' }, 400),
    json(page({ cursor: 'fresh', added: ['fresh-row'] })),
  ]);

  await expect(client.syncTransactions({ accessToken: 'access' })).resolves.toEqual({
    cursor: 'fresh',
    added: [tx('fresh-row')],
    modified: [],
    removed: [],
  });
  expect(request.mock.calls.map(([, options]) => JSON.parse(String(options?.body)).cursor)).toEqual([
    undefined,
    'stale',
    undefined,
  ]);
});

it('keeps secrets and upstream response text out of provider errors', async () => {
  const { client } = makeClient([json({ error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'sensitive details' }, 400)]);

  const error = await client.getAccounts({ accessToken: 'sensitive token' }).catch((failure: unknown) => failure);
  expect(error).toBeInstanceOf(PlaidApiError);
  expect(error).toMatchObject({ code: 'ITEM_LOGIN_REQUIRED', status: 400 });
  expect(String(error)).not.toMatch(/sensitive|test-secret/);
});

it('rejects a malformed account list', async () => {
  const { client } = makeClient([json({ accounts: [{ account_id: 'a' }] })]);
  await expect(client.getAccounts({ accessToken: 'access' })).rejects.toMatchObject({
    status: 502,
    code: 'MALFORMED_RESPONSE',
  });
});

it('rejects a successful-looking page that lacks a cursor instead of returning an unusable checkpoint', async () => {
  const { client } = makeClient([json({ added: [], modified: [], removed: [], has_more: false })]);
  await expect(client.syncTransactions({ accessToken: 'access' })).rejects.toMatchObject({ status: 502 });
});

it('rejects a cursor cycle without fetching the same page again', async () => {
  const { client, request } = makeClient([
    json(page({ cursor: 'next', hasMore: true })),
    json(page({ cursor: 'start', hasMore: true })),
  ]);
  await expect(client.syncTransactions({ accessToken: 'access', cursor: 'start' })).rejects.toMatchObject({
    status: 502,
  });
  expect(request).toHaveBeenCalledTimes(2);
});

it('does not advance an established cursor on a malformed empty checkpoint', async () => {
  const { client } = makeClient([json(page({ cursor: '' }))]);
  await expect(client.syncTransactions({ accessToken: 'access', cursor: 'existing' })).rejects.toMatchObject({
    status: 502,
  });
});

it('allows an empty checkpoint while Plaid prepares initial history', async () => {
  const { client } = makeClient([json(page({ cursor: '' }))]);
  await expect(client.syncTransactions({ accessToken: 'access' })).resolves.toMatchObject({ cursor: '', added: [] });
});
