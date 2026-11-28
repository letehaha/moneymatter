import { isSelfHost } from '@config/is-self-host';
import { z } from 'zod';

interface PlaidConfig {
  clientId: string;
  secret: string;
  environment: 'sandbox' | 'production';
  redirectUri?: string;
}

/** Returns the config, or the reason it is invalid. Never includes secret values. */
export const readPlaidConfig = (): PlaidConfig | string => {
  if (!isSelfHost()) return 'Plaid is only available on self-hosted instances';
  const clientId = process.env.PLAID_CLIENT_ID?.trim();
  const secret = process.env.PLAID_SECRET?.trim();
  const environment = process.env.PLAID_ENV?.trim();
  if (!clientId) return 'PLAID_CLIENT_ID is not set';
  if (!secret) return 'PLAID_SECRET is not set';
  if (environment !== 'sandbox' && environment !== 'production') return 'PLAID_ENV must be "sandbox" or "production"';
  const redirectUri = process.env.PLAID_REDIRECT_URI?.trim() || undefined;
  if (redirectUri) {
    const url = URL.parse(redirectUri);
    const sandboxLocalhost = environment === 'sandbox' && url?.protocol === 'http:' && url.hostname === 'localhost';
    if (
      !url ||
      (!sandboxLocalhost && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return 'PLAID_REDIRECT_URI must be an https URL without credentials, query or fragment';
    }
  }
  return { clientId, secret, environment, ...(redirectUri && { redirectUri }) };
};

export const getPlaidConfig = (): PlaidConfig | null => {
  const config = readPlaidConfig();
  return typeof config === 'string' ? null : config;
};

export const plaidCredentialsSchema = z.object({
  access_token: z.string().min(1),
  item_id: z.string().min(1),
});

const accountSchema = z.object({
  account_id: z.string(),
  name: z.string(),
  type: z.enum(['depository', 'credit', 'loan', 'investment', 'brokerage', 'other']).catch('other'),
  subtype: z.string().nullable(),
  balances: z.object({
    current: z.number().nullable(),
    available: z.number().nullable(),
    limit: z.number().nullable(),
    iso_currency_code: z.string().nullable(),
    unofficial_currency_code: z.string().nullish(),
  }),
});

const transactionSchema = z.object({
  transaction_id: z.string(),
  account_id: z.string(),
  amount: z.number(),
  date: z.string(),
  name: z.string(),
  merchant_name: z.string().nullish(),
  pending: z.boolean(),
  iso_currency_code: z.string().nullable(),
  unofficial_currency_code: z.string().nullish(),
});

const syncPageSchema = z.object({
  added: z.array(transactionSchema),
  modified: z.array(transactionSchema),
  removed: z.array(z.object({ transaction_id: z.string(), account_id: z.string().optional() })),
  next_cursor: z.string(),
  has_more: z.boolean(),
});

const errorSchema = z.object({ error_code: z.string().nullish(), error_type: z.string().nullish() });

export type PlaidAccount = z.infer<typeof accountSchema>;
export type PlaidTransaction = z.infer<typeof transactionSchema>;
type TransactionChanges = Pick<z.infer<typeof syncPageSchema>, 'added' | 'modified' | 'removed'>;
export type PlaidSyncDelta = TransactionChanges & { cursor: string };

const mutationError = 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION';

export class PlaidApiError extends Error {
  constructor({
    status,
    code,
    type = null,
    cause,
  }: {
    status: number;
    code: string | null;
    type?: string | null;
    cause?: unknown;
  }) {
    super('Plaid could not complete the request.', { cause });
    this.name = 'PlaidApiError';
    this.status = status;
    this.code = code;
    this.type = type;
  }

  readonly status: number;
  readonly code: string | null;
  readonly type: string | null;
}

export class PlaidApiClient {
  private readonly config: PlaidConfig;
  private readonly request: typeof fetch;

  constructor({ config, request = fetch }: { config: PlaidConfig; request?: typeof fetch }) {
    this.config = config;
    this.request = request;
  }

  async createLinkToken({ userId }: { userId: number }): Promise<string> {
    const result = await this.post({
      path: '/link/token/create',
      body: {
        client_name: 'MoneyMatter',
        user: { client_user_id: String(userId) },
        country_codes: ['US', 'CA'],
        language: 'en',
        ...(this.config.redirectUri ? { redirect_uri: this.config.redirectUri } : {}),
        products: ['transactions'],
        transactions: { days_requested: 730 },
      },
      schema: z.object({ link_token: z.string().min(1) }),
    });
    return result.link_token;
  }

  exchangePublicToken({ publicToken }: { publicToken: string }) {
    return this.post({
      path: '/item/public_token/exchange',
      body: { public_token: publicToken },
      schema: plaidCredentialsSchema,
    });
  }

  async getAccounts({ accessToken }: { accessToken: string }): Promise<PlaidAccount[]> {
    const result = await this.post({
      path: '/accounts/get',
      body: { access_token: accessToken },
      schema: z.object({ accounts: z.array(accountSchema) }),
    });
    return result.accounts;
  }

  async removeItem({ accessToken }: { accessToken: string }): Promise<void> {
    await this.post({ path: '/item/remove', body: { access_token: accessToken }, schema: z.object({}) });
  }

  async syncTransactions(input: { accessToken: string; cursor?: string }): Promise<PlaidSyncDelta> {
    try {
      return await this.collectTransactionPages(input);
    } catch (error) {
      // Plaid invalidates the entire page sequence, not just the failed page.
      if (!(error instanceof PlaidApiError) || error.code !== mutationError) throw error;
      return this.collectTransactionPages(input);
    }
  }

  private async collectTransactionPages({
    accessToken,
    cursor,
  }: {
    accessToken: string;
    cursor?: string;
  }): Promise<PlaidSyncDelta> {
    const changes: TransactionChanges = { added: [], modified: [], removed: [] };
    const seenCursors = new Set(cursor ? [cursor] : []);
    let nextCursor = cursor;
    while (true) {
      const page = await this.post({
        path: '/transactions/sync',
        body: {
          access_token: accessToken,
          cursor: nextCursor,
          count: 500,
        },
        schema: syncPageSchema,
      });
      // An empty initial cursor means history is not ready; it must not accompany any changes.
      if (!page.next_cursor && (nextCursor || page.added.length || page.modified.length || page.removed.length)) {
        throw new PlaidApiError({ status: 502, code: null });
      }
      changes.added.push(...page.added);
      changes.modified.push(...page.modified);
      changes.removed.push(...page.removed);
      if (!page.has_more) return { ...changes, cursor: page.next_cursor };
      if (!page.next_cursor || seenCursors.has(page.next_cursor)) {
        throw new PlaidApiError({ status: 502, code: null });
      }
      seenCursors.add(page.next_cursor);
      nextCursor = page.next_cursor;
    }
  }

  private async post<S extends z.ZodType>({
    path,
    body,
    schema,
  }: {
    path: string;
    body: Record<string, unknown>;
    schema: S;
  }): Promise<z.infer<S>> {
    const response = await this.request(`https://${this.config.environment}.plaid.com${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Plaid-Version': '2020-09-14' },
      body: JSON.stringify({ ...body, client_id: this.config.clientId, secret: this.config.secret }),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    }).catch((cause: unknown) => {
      throw new PlaidApiError({ status: 503, code: null, cause });
    });

    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = errorSchema.safeParse(data);
      throw new PlaidApiError({
        status: response.status,
        code: error.data?.error_code ?? null,
        type: error.data?.error_type ?? null,
      });
    }
    const result = schema.safeParse(data);
    if (!result.success) {
      throw new PlaidApiError({
        status: 502,
        code: 'MALFORMED_RESPONSE',
        cause: result.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })),
      });
    }
    return result.data;
  }
}
