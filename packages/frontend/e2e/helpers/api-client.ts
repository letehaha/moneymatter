import type { APIRequestContext } from '@playwright/test';

const API_BASE_URL = process.env.PLAYWRIGHT_API_BASE_URL || 'https://localhost:8081';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'https://localhost:8100';

export { API_BASE_URL, BASE_URL };

/**
 * Extract an entity ID (UUID string) from API responses, handling shapes:
 *   { response: { id } } | { response: [{ id }] } | { id }
 */
export function extractId(apiResult: unknown): string {
  if (!apiResult || typeof apiResult !== 'object') {
    throw new Error(`Invalid API response: ${JSON.stringify(apiResult).slice(0, 200)}`);
  }
  const r = apiResult as { response?: { id?: string } | { id?: string }[]; id?: string };
  const resp = r.response;
  const id = Array.isArray(resp) ? resp[0]?.id : (resp?.id ?? r.id);
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`Failed to extract ID from API response: ${JSON.stringify(apiResult).slice(0, 200)}`);
  }
  return id;
}

// ─── Generic request helpers ─────────────────────────────────────────

async function assertOk({
  response,
  label,
}: {
  response: { ok(): boolean; status(): number; text(): Promise<string> };
  label: string;
}): Promise<void> {
  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`${label}: ${response.status()} ${body}`);
  }
}

export async function apiPost({ request, path, data }: { request: APIRequestContext; path: string; data: unknown }) {
  const response = await request.post(`${API_BASE_URL}${path}`, { data });
  await assertOk({ response, label: `API POST ${path} failed` });
  return response.json();
}

export async function apiPut({ request, path, data }: { request: APIRequestContext; path: string; data: unknown }) {
  const response = await request.put(`${API_BASE_URL}${path}`, { data });
  await assertOk({ response, label: `API PUT ${path} failed` });
  return response.json();
}

export async function apiPatch({ request, path, data }: { request: APIRequestContext; path: string; data: unknown }) {
  const response = await request.patch(`${API_BASE_URL}${path}`, { data });
  await assertOk({ response, label: `API PATCH ${path} failed` });
  return response.json();
}

export async function apiDelete({ request, path, data }: { request: APIRequestContext; path: string; data?: unknown }) {
  const response = await request.delete(`${API_BASE_URL}${path}`, { ...(data !== undefined && { data }) });
  await assertOk({ response, label: `API DELETE ${path} failed` });
  // DELETE may return empty body
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

// ─── Auth ────────────────────────────────────────────────────────────

/**
 * Creates an authenticated API request context by signing up a fresh user.
 * Sign-up returns session cookies directly, avoiding email-verification issues.
 */
export async function createAuthenticatedApiContext({
  playwright,
  email,
  password,
  name,
}: {
  playwright: { request: { newContext: (options: Record<string, unknown>) => Promise<APIRequestContext> } };
  email: string;
  password: string;
  name: string;
}): Promise<APIRequestContext> {
  const request = await playwright.request.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Origin: BASE_URL },
  });

  await apiPost({
    request,
    path: '/api/v1/auth/sign-up/email',
    data: { email, password, name },
  });

  return request;
}

export async function signUpViaFetch({
  email,
  password,
  name,
}: {
  email: string;
  password: string;
  name: string;
}): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
    body: JSON.stringify({ email, password, name }),
  });

  if (!response.ok) {
    throw new Error(`Sign-up failed: ${response.status} ${await response.text()}`);
  }
}

export async function verifyEmailViaFetch({ email }: { email: string }): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/tests/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
    body: JSON.stringify({ email }),
  });

  // The /tests/* routes are only available when NODE_ENV is "test" or "development".
  // On preview (production), skip gracefully — email verification is not enforced there.
  if (response.status === 404) return;

  if (!response.ok) {
    throw new Error(`Email verification failed: ${response.status} ${await response.text()}`);
  }
}

export async function verifyEmail({ request, email }: { request: APIRequestContext; email: string }) {
  return apiPost({ request, path: '/api/v1/tests/verify-email', data: { email } });
}

// ─── User / Currency ─────────────────────────────────────────────────

export async function setBaseCurrency({ request, currencyCode }: { request: APIRequestContext; currencyCode: string }) {
  return apiPost({ request, path: '/api/v1/user/currencies/base', data: { currencyCode } });
}

export async function addUserCurrencies({
  request,
  currencyCode,
}: {
  request: APIRequestContext;
  currencyCode: string;
}) {
  return apiPost({
    request,
    path: '/api/v1/user/currencies',
    data: { currencies: [{ currencyCode }] },
  });
}

/**
 * Completes onboarding by setting the base currency and adding it to the user's list.
 */
export async function completeOnboarding({
  request,
  currencyCode,
}: {
  request: APIRequestContext;
  currencyCode: string;
}): Promise<void> {
  await setBaseCurrency({ request, currencyCode });
  await addUserCurrencies({ request, currencyCode });
  await dismissOnboarding({ request });
}

export async function dismissOnboarding({ request }: { request: APIRequestContext }): Promise<void> {
  await apiPut({
    request,
    path: '/api/v1/user/settings/onboarding',
    data: { isDismissed: true, dismissedAt: new Date().toISOString() },
  });
}

// ─── Accounts ────────────────────────────────────────────────────────

export async function createAccount({
  request,
  name,
  currencyCode,
  initialBalance,
  type,
  accountCategory = 'general',
  creditLimit = 0,
}: {
  request: APIRequestContext;
  name: string;
  currencyCode: string;
  initialBalance: number;
  /** `ACCOUNT_CATEGORIES` value; loan and vehicle are rejected here (use createLoan / createVehicle). */
  accountCategory?: string;
  creditLimit?: number;
  /**
   * Account type. Defaults to "system" (regular user account).
   * Use "monobank" to create an external account — only allowed outside production.
   * Mirrors the e2e-relevant subset of `ACCOUNT_TYPES` from `@bt/shared/types`
   * (kept inline because the e2e tsconfig has no path mapping for shared types).
   */
  type?: 'system' | 'monobank';
}) {
  return apiPost({
    request,
    path: '/api/v1/accounts',
    data: {
      name,
      currencyCode,
      initialBalance,
      creditLimit,
      accountCategory,
      ...(type !== undefined && { type }),
    },
  });
}

// ─── Loans ───────────────────────────────────────────────────────────

/** POST /loans with an outstanding `balance` (positive); the backend stores it as a negative liability. */
export async function createLoan({
  request,
  name,
  currencyCode,
  balance,
}: {
  request: APIRequestContext;
  name: string;
  currencyCode: string;
  balance: number;
}) {
  return apiPost({
    request,
    path: '/api/v1/loans',
    data: {
      name,
      currencyCode,
      initialBalance: balance,
      originalPrincipal: balance,
      loanType: 'mortgage',
      interestRate: 6,
      startDate: '2020-06-15',
    },
  });
}

// ─── Vehicles ────────────────────────────────────────────────────────

/** POST /vehicles with a flat 0% depreciation, so the vehicle stays worth its `purchasePrice`. */
export async function createVehicle({
  request,
  name,
  currencyCode,
  purchasePrice,
}: {
  request: APIRequestContext;
  name: string;
  currencyCode: string;
  purchasePrice: number;
}) {
  return apiPost({
    request,
    path: '/api/v1/vehicles',
    data: {
      name,
      currencyCode,
      make: 'Toyota',
      model: 'Corolla',
      year: 2020,
      vehicleClass: 'sedan',
      purchasePrice,
      purchaseDate: '2020-01-01',
      depreciationPreset: 'custom',
      customAnnualRatePct: 0,
    },
  });
}

// ─── Portfolios ──────────────────────────────────────────────────────

export async function createPortfolio({ request, name }: { request: APIRequestContext; name: string }) {
  return apiPost({ request, path: '/api/v1/investments/portfolios', data: { name } });
}

// ─── Venture ─────────────────────────────────────────────────────────

export async function createVenturePlatform({
  request,
  payload,
}: {
  request: APIRequestContext;
  payload: {
    name: string;
    defaultEntryFeePct?: string;
    defaultCarryPct?: string;
    defaultHurdlePct?: string;
    defaultMgmtFeePct?: string;
  };
}) {
  return apiPost({ request, path: '/api/v1/venture/platforms', data: payload });
}

export async function createVentureDeal({
  request,
  payload,
}: {
  request: APIRequestContext;
  payload: {
    name: string;
    currencyCode: string;
    principal: string;
    investmentDate: string;
    platformId?: string;
    entryFeePct?: string;
    carryPct?: string;
    hurdlePct?: string;
    mgmtFeePct?: string;
  };
}) {
  return apiPost({ request, path: '/api/v1/venture/deals', data: payload });
}

export async function createVentureEvent({
  request,
  dealId,
  payload,
}: {
  request: APIRequestContext;
  dealId: string;
  payload: {
    type: string;
    eventDate: string;
    cashFlowMode: 'linked' | 'out_of_wallet' | 'none';
    grossAmount?: string;
    navAfter?: string;
    transactionIds?: string[];
    gpCarryOverride?: string;
    lpNetAmountOverride?: string;
  };
}) {
  return apiPost({ request, path: `/api/v1/venture/deals/${dealId}/events`, data: payload });
}

export async function getVentureDeal({ request, dealId }: { request: APIRequestContext; dealId: string }) {
  const response = await request.get(`${API_BASE_URL}/api/v1/venture/deals/${dealId}`);
  if (!response.ok()) {
    throw new Error(`getVentureDeal failed: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

export async function setPortfolioCash({
  request,
  portfolioId,
  currencyCode,
  amount,
}: {
  request: APIRequestContext;
  portfolioId: string;
  currencyCode: string;
  amount: string;
}) {
  return apiPut({
    request,
    path: `/api/v1/investments/portfolios/${portfolioId}/balance`,
    data: { currencyCode, setAvailableCash: amount },
  });
}

// ─── Categories ──────────────────────────────────────────────────────

export async function apiGet({ request, path }: { request: APIRequestContext; path: string }) {
  const response = await request.get(`${API_BASE_URL}${path}`);
  await assertOk({ response, label: `API GET ${path} failed` });
  return response.json();
}

const categoryIdCache = new WeakMap<APIRequestContext, string>();

async function resolveDefaultCategoryId({ request }: { request: APIRequestContext }): Promise<string> {
  const cached = categoryIdCache.get(request);
  if (cached !== undefined) return cached;

  const result = await apiGet({ request, path: '/api/v1/categories' });
  const categories: Array<{ id: string }> = result.response ?? result;
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new Error('No categories available for the test user');
  }
  const id = categories[0]!.id;
  categoryIdCache.set(request, id);
  return id;
}

export async function createCategory({
  request,
  name,
  color,
  parentId,
}: {
  request: APIRequestContext;
  name: string;
  color?: string;
  parentId?: string;
}) {
  return apiPost({
    request,
    path: '/api/v1/categories',
    data: { name, ...(color !== undefined && { color }), ...(parentId !== undefined && { parentId }) },
  });
}

// ─── Transactions ────────────────────────────────────────────────────

export async function createTransaction({
  request,
  accountId,
  amount,
  transactionType = 'expense',
  categoryId,
  transferNature = 'not_transfer',
  note,
  time = new Date().toISOString(),
}: {
  request: APIRequestContext;
  accountId: string;
  amount: number;
  transactionType?: 'expense' | 'income';
  categoryId?: string;
  transferNature?: 'not_transfer' | 'transfer_between_user_accounts' | 'transfer_out_wallet';
  note?: string;
  time?: string;
}) {
  const resolvedCategoryId = categoryId ?? (await resolveDefaultCategoryId({ request }));
  return apiPost({
    request,
    path: '/api/v1/transactions',
    data: {
      accountId,
      amount,
      transactionType,
      categoryId: resolvedCategoryId,
      transferNature,
      paymentType: 'creditCard',
      time,
      ...(note !== undefined && { note }),
    },
  });
}

export async function getTransaction({ request, id }: { request: APIRequestContext; id: string }) {
  return apiGet({ request, path: `/api/v1/transactions/${id}` });
}

export async function linkTransactions({
  request,
  ids,
}: {
  request: APIRequestContext;
  ids: [baseTxId: string, oppositeTxId: string][];
}) {
  return apiPut({
    request,
    path: '/api/v1/transactions/link',
    data: { ids },
  });
}

export async function linkTransactionToPortfolio({
  request,
  transactionId,
  portfolioId,
}: {
  request: APIRequestContext;
  transactionId: string;
  portfolioId: string;
}) {
  return apiPost({
    request,
    path: `/api/v1/transactions/${transactionId}/link-to-portfolio`,
    data: { portfolioId },
  });
}

// ─── Transaction Groups ─────────────────────────────────────────────

export async function createTransactionGroup({
  request,
  name,
  transactionIds,
  note,
}: {
  request: APIRequestContext;
  name: string;
  transactionIds: string[];
  note?: string | null;
}) {
  return apiPost({
    request,
    path: '/api/v1/transaction-groups',
    data: { name, transactionIds, ...(note !== undefined && { note }) },
  });
}

export async function addTransactionsToGroup({
  request,
  groupId,
  transactionIds,
}: {
  request: APIRequestContext;
  groupId: string;
  transactionIds: string[];
}) {
  return apiPost({
    request,
    path: `/api/v1/transaction-groups/${groupId}/transactions`,
    data: { transactionIds },
  });
}

// ─── Sharing ─────────────────────────────────────────────────────────

export async function createShareInvitation({
  request,
  inviteeEmail,
  resourceId,
  permission,
  policy,
}: {
  request: APIRequestContext;
  inviteeEmail: string;
  resourceId: number | string;
  permission: 'read' | 'write' | 'manage';
  policy?: { transactionsWriteScope?: 'all' | 'own' } | null;
}): Promise<{ token: string }> {
  const result = await apiPost({
    request,
    path: '/api/v1/share/invitations',
    data: {
      inviteeEmail,
      resourceType: 'account',
      resourceId,
      permission,
      ...(policy !== undefined && { policy }),
    },
  });
  const token = result.response?.token ?? result.token;
  if (!token) {
    throw new Error(`Invitation create did not return a token: ${JSON.stringify(result).slice(0, 200)}`);
  }
  return { token };
}

export async function acceptShareInvitation({
  request,
  token,
}: {
  request: APIRequestContext;
  token: string;
}): Promise<void> {
  await apiPost({
    request,
    path: `/api/v1/share/invitations/${encodeURIComponent(token)}/accept`,
    data: {},
  });
}

export async function signInViaApi({
  playwright,
  email,
  password,
}: {
  playwright: { request: { newContext: (options: Record<string, unknown>) => Promise<APIRequestContext> } };
  email: string;
  password: string;
}): Promise<APIRequestContext> {
  const request = await playwright.request.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Origin: BASE_URL },
  });
  await apiPost({
    request,
    path: '/api/v1/auth/sign-in/email',
    data: { email, password },
  });
  return request;
}

// ─── Holdings ────────────────────────────────────────────────────────

/** Seeds via a real search so the backend accepts the result; relies on the backend's test fixture securities. */
export async function createHolding({
  request,
  portfolioId,
  symbol,
  currencyCode = 'USD',
}: {
  request: APIRequestContext;
  portfolioId: string;
  symbol: string;
  currencyCode?: string;
}) {
  const search = await apiGet({
    request,
    path: `/api/v1/investments/securities/search?query=${encodeURIComponent(symbol)}`,
  });
  const results: Array<{ symbol: string; currencyCode: string }> = search.response;
  const searchResult = results.find((r) => r.symbol === symbol && r.currencyCode === currencyCode);
  if (!searchResult) {
    throw new Error(`createHolding: no search result for ${symbol} (${currencyCode})`);
  }

  return apiPost({
    request,
    path: '/api/v1/investments/holding',
    data: { portfolioId, searchResult },
  });
}

// ─── Subscriptions (Recurring Payments) ──────────────────────────────

type SubscriptionFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semi_annual' | 'annual';

/**
 * POST /subscriptions. `expectedAmount` is a decimal and must always travel with
 * `expectedCurrencyCode`; the API rejects either one alone.
 */
export async function createSubscription({
  request,
  payload,
}: {
  request: APIRequestContext;
  payload: {
    name: string;
    frequency: SubscriptionFrequency;
    startDate: string;
    type?: 'subscription' | 'bill' | 'installment';
    transactionType?: 'expense' | 'income';
    expectedAmount?: number | null;
    expectedCurrencyCode?: string | null;
    dueDate?: string | null;
    maxOccurrences?: number | null;
    endDate?: string | null;
    accountId?: string | null;
    categoryId?: string | null;
    notes?: string | null;
  };
}) {
  return apiPost({ request, path: '/api/v1/subscriptions', data: payload });
}

export async function createInvestmentTransaction({
  request,
  portfolioId,
  securityId,
  category,
  date,
  quantity,
  price,
  fees,
}: {
  request: APIRequestContext;
  portfolioId: string;
  securityId: string;
  category: 'buy' | 'sell' | 'dividend' | 'transfer' | 'tax' | 'fee' | 'cancel' | 'other';
  date: string;
  quantity: string;
  price: string;
  fees?: string;
}) {
  return apiPost({
    request,
    path: '/api/v1/investments/transaction',
    data: { portfolioId, securityId, category, date, quantity, price, ...(fees !== undefined && { fees }) },
  });
}
