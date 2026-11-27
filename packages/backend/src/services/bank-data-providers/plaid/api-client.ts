import { isSelfHost } from '@config/is-self-host';

interface PlaidConfig {
  clientId: string;
  secret: string;
  environment: 'sandbox' | 'production';
  redirectUri?: string;
}

export const getPlaidConfig = (): PlaidConfig | null => {
  const clientId = process.env.PLAID_CLIENT_ID?.trim();
  const secret = process.env.PLAID_SECRET?.trim();
  const environment = process.env.PLAID_ENV;
  if (
    !isSelfHost() ||
    !clientId ||
    !secret ||
    (environment !== 'sandbox' && environment !== 'production')
  ) {
    return null;
  }
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
      return null;
    }
  }
  return { clientId, secret, environment, ...(redirectUri && { redirectUri }) };
};

export interface PlaidAccount {
  account_id: string;
  name: string;
  type: string;
  subtype: string | null;
  balances: {
    current: number | null;
    available: number | null;
    limit: number | null;
    iso_currency_code: string | null;
  };
}

export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  amount: number;
  date: string;
  name: string;
  merchant_name: string | null;
  pending: boolean;
  iso_currency_code: string | null;
}

interface TransactionChanges {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transaction_id: string; account_id?: string }[];
}

export interface PlaidSyncDelta extends TransactionChanges {
  cursor: string;
}

interface TransactionSyncPage extends TransactionChanges {
  next_cursor: string;
  has_more: boolean;
}

const mutationError = 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION';

export class PlaidApiError extends Error {
  constructor({ status, code }: { status: number; code: string | null }) {
    super('Plaid could not complete the request.');
    this.name = 'PlaidApiError';
    this.status = status;
    this.code = code;
  }

  readonly status: number;
  readonly code: string | null;
}

export class PlaidApiClient {
  private readonly config: PlaidConfig;
  private readonly request: typeof fetch;

  constructor({ config, request = fetch }: { config: PlaidConfig; request?: typeof fetch }) {
    this.config = config;
    this.request = request;
  }

  async createLinkToken({ userId }: { userId: number }): Promise<string> {
    const result = await this.post<{ link_token: string }>({
      path: '/link/token/create',
      body: {
        client_name: 'MoneyMatter',
        user: { client_user_id: String(userId) },
        country_codes: ['US', 'CA'],
        language: 'en',
        ...(this.config.redirectUri ? { redirect_uri: this.config.redirectUri } : {}),
        products: ['transactions'],
      },
    });
    if (typeof result.link_token !== 'string' || !result.link_token) {
      throw new PlaidApiError({ status: 502, code: null });
    }
    return result.link_token;
  }

  async exchangePublicToken({
    publicToken,
  }: {
    publicToken: string;
  }): Promise<{ access_token: string; item_id: string }> {
    const result = await this.post<{ access_token: string; item_id: string }>({
      path: '/item/public_token/exchange',
      body: { public_token: publicToken },
    });
    if (
      typeof result.access_token !== 'string' ||
      !result.access_token ||
      typeof result.item_id !== 'string' ||
      !result.item_id
    ) {
      throw new PlaidApiError({ status: 502, code: null });
    }
    return result;
  }


  async getAccounts({ accessToken }: { accessToken: string }): Promise<PlaidAccount[]> {
    const result = await this.post<{ accounts: PlaidAccount[] }>({
      path: '/accounts/get',
      body: { access_token: accessToken },
    });
    if (!Array.isArray(result.accounts)) throw new PlaidApiError({ status: 502, code: null });
    return result.accounts;
  }

  async removeItem({ accessToken }: { accessToken: string }): Promise<void> {
    await this.post({ path: '/item/remove', body: { access_token: accessToken } });
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
      const page: TransactionSyncPage = await this.post({
        path: '/transactions/sync',
        body: {
          access_token: accessToken,
          cursor: nextCursor,
          count: 500,
        },
      });
      if (
        typeof page.next_cursor !== 'string' ||
        typeof page.has_more !== 'boolean' ||
        !Array.isArray(page.added) ||
        !Array.isArray(page.modified) ||
        !Array.isArray(page.removed)
      ) {
        throw new PlaidApiError({ status: 502, code: null });
      }
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

  private async post<T>({ path, body }: { path: string; body: Record<string, unknown> }): Promise<T> {
    const response = await this.request(`https://${this.config.environment}.plaid.com${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Plaid-Version': '2020-09-14' },
      body: JSON.stringify({ ...body, client_id: this.config.clientId, secret: this.config.secret }),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    }).catch(() => {
      throw new PlaidApiError({ status: 503, code: null });
    });

    const data: unknown = await response.json().catch(() => null);
    if (!response.ok || !data || typeof data !== 'object') {
      const code =
        data && typeof data === 'object' && 'error_code' in data && typeof data.error_code === 'string'
          ? data.error_code
          : null;
      throw new PlaidApiError({ status: response.ok ? 502 : response.status, code });
    }
    return data as T;
  }
}
