/**
 * Enable Banking API client
 * Handles all HTTP communication with Enable Banking's API
 *
 * API Documentation: https://enablebanking.com/docs/api/reference
 */
import { requestContext } from '@common/request-context';
import { t } from '@i18n/index';
import { BadGateway, BadRequestError, ForbiddenError, TooManyRequests, ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import axios, { AxiosInstance } from 'axios';

import {
  ASPSP,
  ASPSPsResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  EnableBankingAccount,
  EnableBankingBalance,
  EnableBankingCredentials,
  SessionDetails,
  StartAuthorizationRequest,
  StartAuthorizationResponse,
  TransactionsQuery,
  HalTransactions,
} from './types';
import { generateJWT } from './utils/jwt-utils';

/**
 * JSON.stringify that falls back to `String(value)` when serialization throws
 * (circular references, BigInt members, throwing toJSON, etc.). Logs a warning
 * on the fallback path so a degraded serialization is at least visible –
 * silently returning "[object Object]" would destroy debugging info in Sentry.
 */
export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch (err) {
    logger.warn(`[EnableBankingApiClient] safeStringify fallback: ${err instanceof Error ? err.message : String(err)}`);
    return String(value);
  }
}

/**
 * Reason an ASPSP_ERROR was classified as an auth failure. Captured in logs so
 * we can audit which branch fired (regression-proofing the regex).
 */
type AspspAuthFailureReason = 'nested-code' | 'nested-status' | 'keyword-match';

/**
 * Strict keyword pattern for cases where Enable Banking strips `error_data`
 * (seen in dev) but the wrapper / nested message still describes an auth or
 * consent failure. Each alternative is anchored to phrases that strongly
 * imply auth state – bare words like "forbidden" or "unauthorized" were
 * intentionally removed to avoid promoting unrelated 400s (e.g. "Operation
 * forbidden by bank during maintenance") into connection deactivations.
 */
const ASPSP_AUTH_FAILURE_KEYWORDS =
  /refresh.?token|token.*(?:expired|invalid|revoked)|session.*(?:expired|invalid|revoked)|consent.*(?:expired|invalid|revoked|withdrawn)|consent\s+status.*(?:not|n['’]t)\s+allow|reauthorization|reauthenticate|access.*(?:token|not\s+allowed)|forbidden.*authenticated|authenticated.*forbidden|psd2.*consent/;

/**
 * Detect when an Enable Banking 4xx actually represents an upstream
 * session/token/consent failure. Matches on either:
 *   - nested HTTP code/status of 401 or 403 (string "401"/"403 FORBIDDEN" or numeric)
 *   - strict keyword pattern in the wrapper or nested message
 *
 * Returns `{ matched: false }` when no signal is found so the caller can log
 * which branch matched and audit misclassifications in Sentry.
 */
export function classifyAspspError({
  detail,
  aspspMessage,
}: {
  detail: Record<string, unknown>;
  aspspMessage?: string;
}): { matched: true; reason: AspspAuthFailureReason } | { matched: false } {
  const errorData = (detail.error_data ?? {}) as Record<string, unknown>;

  const nestedCode = errorData.code;
  if (typeof nestedCode === 'string' && /^\s*(?:401|403)\b/.test(nestedCode)) {
    return { matched: true, reason: 'nested-code' };
  }
  if (typeof nestedCode === 'number' && (nestedCode === 401 || nestedCode === 403)) {
    return { matched: true, reason: 'nested-code' };
  }

  const nestedStatus = errorData.status;
  if (typeof nestedStatus === 'number' && (nestedStatus === 401 || nestedStatus === 403)) {
    return { matched: true, reason: 'nested-status' };
  }
  if (typeof nestedStatus === 'string' && /^\s*(?:401|403)\b/.test(nestedStatus)) {
    return { matched: true, reason: 'nested-status' };
  }

  const nestedMessage = typeof errorData.message === 'string' ? errorData.message : '';
  const combined = `${aspspMessage ?? ''} ${nestedMessage}`.toLowerCase();
  if (ASPSP_AUTH_FAILURE_KEYWORDS.test(combined)) {
    return { matched: true, reason: 'keyword-match' };
  }

  return { matched: false };
}

/**
 * True when 400 from /transactions means the bank refused the lookback as too wide.
 * Callers shrink the window and retry on true.
 *
 * PSD2 caps vary per ASPSP (BNP Fortis BE: 2y; others: 90d; German banks: up to 7y)
 * with no API to query the limit up-front.
 *
 * Match: concept anchor + limit verb + time window, all three required.
 *   concept    – datefrom/dateto/date OR range/period/window/lookback/history/interval/transactions
 *   limit verb – within/exceed/maximum/limited to/older than/less than/more than
 *   time       – N (digits or one..twelve) day/week/month/year
 * Each alone is too permissive (e.g. "account opened within last 30 days" hits
 * limit + time but has no concept anchor). Bare "date" is an anchor because
 * BNP Paribas rejects with "The date must be equal or less than 13 months".
 * The wrapper `error` tag is not checked: BNP puts its own code there
 * (WRONG_TRANSACTIONS_PERIOD), not "ASPSP_ERROR".
 */
export function isAspspDateRangeRejection(error: unknown): boolean {
  if (!(error instanceof BadRequestError)) return false;

  const details = error.details as
    | { method?: unknown; aspspMessage?: unknown; aspspErrorDataStr?: unknown }
    | undefined;
  if (!details) return false;
  if (details.method !== 'getAccountTransactions') return false;

  const parts: string[] = [];
  if (typeof details.aspspMessage === 'string') parts.push(details.aspspMessage);
  if (typeof details.aspspErrorDataStr === 'string') parts.push(details.aspspErrorDataStr);
  if (typeof error.message === 'string') parts.push(error.message);
  const haystack = parts.join(' ').toLowerCase();
  if (haystack === '') return false;

  const hasLimitVerb =
    /\b(?:within|exceed|exceeds|maximum|max|limited?\s+to|older\s+than|less\s+than|more\s+than)\b/.test(haystack);
  // SNS (NL): "One or more date fields are more than two years in the past."
  const hasTimeWindow =
    /\b(?:\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:day|week|month|year)s?\b/.test(
      haystack,
    );
  if (!hasLimitVerb || !hasTimeWindow) return false;

  const hasFieldName = /\b(?:datefrom|dateto|dates?)\b/.test(haystack);
  const hasRangeNoun = /\b(?:range|period|window|lookback|history|interval|transactions?)\b/.test(haystack);
  return hasFieldName || hasRangeNoun;
}

/**
 * Exponential backoff delays for transient-error retries on slow ASPSP
 * transactions endpoints. List length defines the max retry count.
 */
const RETRY_DELAYS_MS = [500, 1500, 3500];

const RETRYABLE_AXIOS_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND']);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry only on transient signals – timeouts, dropped connections, and 5xx –
 * never on 4xx, since those won't change on retry and would either burn time
 * (BadRequestError) or hide a real auth failure (ForbiddenError).
 */
function isRetryableAxiosError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  if (error.code && RETRYABLE_AXIOS_CODES.has(error.code)) return true;
  if (!error.response) return true;
  const status = error.response.status;
  return status >= 500 && status < 600;
}

export class EnableBankingApiClient {
  private readonly baseURL = 'https://api.enablebanking.com';
  private client: AxiosInstance;
  private credentials: EnableBankingCredentials;

  constructor(credentials: EnableBankingCredentials) {
    this.credentials = credentials;
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000, // 30 seconds
    });
  }

  /**
   * Generate JWT token for authentication
   * Tokens are valid for 1 hour by default
   */
  private generateAuthToken(): string {
    return generateJWT(this.credentials.appId, this.credentials.privateKey, 3600);
  }

  /**
   * Get authorization headers with JWT token
   */
  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.generateAuthToken()}`,
      'Content-Type': 'application/json',
    };

    // PSD2: banks treat requests without PSU headers as unattended and cap them (often 4/day).
    const psu = requestContext.getContext()?.psu;
    if (psu) {
      headers['psu-ip-address'] = psu.ipAddress;
      headers['psu-user-agent'] = psu.userAgent;
    }

    return headers;
  }

  /**
   * Handle API errors and convert to appropriate error types
   */
  private handleApiError(error: unknown, method: string): never {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = (error.response?.data ?? {}) as Record<string, unknown>;
      const httpUrl = error.config?.url;
      const httpMethod = error.config?.method?.toUpperCase();

      // Enable Banking wraps upstream bank failures as HTTP 4xx with
      // `error: "ASPSP_ERROR"` (some ASPSPs put their own code there instead)
      // and nests the real payload in `detail.error_data`.
      // Flatten those fields to top-level primitives so Sentry's default
      // `normalizeDepth: 3` doesn't truncate them to "[Object]".
      const detail = (data.detail ?? {}) as Record<string, unknown>;
      const aspspError = typeof data.error === 'string' ? data.error : undefined;
      const aspspMessage = typeof detail.message === 'string' ? detail.message : undefined;
      const aspspErrorName = typeof detail.error_name === 'string' ? detail.error_name : undefined;
      let aspspErrorDataStr: string | undefined;
      if (typeof detail.error_data === 'string') {
        aspspErrorDataStr = detail.error_data;
      } else if (detail.error_data != null) {
        aspspErrorDataStr = safeStringify(detail.error_data);
      }

      // Prefer real upstream message over the generic wrapper "Error interacting with ASPSP".
      const message = aspspMessage || (typeof data.message === 'string' ? data.message : error.message);

      const errorDetails = {
        method,
        aspspError,
        aspspErrorName,
        aspspMessage,
        aspspErrorDataStr,
        status,
        httpMethod,
        httpUrl,
        rawData: safeStringify(data),
      };

      if (status === 401 || status === 403) {
        throw new ForbiddenError({
          message: t({ key: 'bankDataProviders.enableBanking.authenticationFailed', variables: { message } }),
          details: errorDetails,
        });
      }

      // A throttle is transient, so it must not reach the 4xx auth classifier below:
      // "Rate limit exceeded for this access token" matches its keywords, which
      // would deactivate the connection until the user redoes the bank consent.
      if (status === 429) {
        throw new TooManyRequests({
          message: t({ key: 'bankDataProviders.enableBanking.rateLimitExceeded' }),
          details: errorDetails,
        });
      }

      // Session/token/consent expiry can arrive as any 4xx: wrapped in an
      // ASPSP_ERROR envelope, or as Enable Banking's own top-level error body.
      // Promote to ForbiddenError so handleProviderError deactivates the
      // connection and the UI prompts a reconnect.
      if (status && status >= 400 && status < 500) {
        const classification = classifyAspspError({ detail, aspspMessage: message });
        if (classification.matched) {
          // Audit log so we can review classifications in Sentry – the wrong
          // call here either silently lets a broken connection keep failing
          // (false negative) or kills a working one (false positive).
          logger.warn(`[EnableBankingApiClient] Classified 4xx as auth failure (reason=${classification.reason})`, {
            ...errorDetails,
            message,
          });
          throw new ForbiddenError({
            message: t({ key: 'bankDataProviders.enableBanking.sessionExpiredReconnect' }),
            details: errorDetails,
          });
        }

        throw new BadRequestError({
          message: t({ key: 'bankDataProviders.enableBanking.apiBadRequestError', variables: { message } }),
          details: errorDetails,
        });
      }

      throw new BadGateway({
        message: t({ key: 'bankDataProviders.enableBanking.apiGeneralError', variables: { message } }),
        details: errorDetails,
      });
    }

    throw error;
  }

  /**
   * Test connection by fetching application info.
   * Returns false only for a genuine auth failure (401/403). Network/5xx errors
   * propagate via handleApiError so callers can distinguish "invalid creds" from
   * "provider is down".
   * @link https://enablebanking.com/docs/api/reference#application-get
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.client.get('/application', {
        headers: this.getAuthHeaders(),
      });
      return true;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 401 || status === 403) {
          return false;
        }
      }
      this.handleApiError(error, 'testConnection');
    }
  }

  /**
   * Get list of all supported ASPSPs (banks)
   * Returns full bank information including auth methods, payment support, etc.
   * @link https://enablebanking.com/docs/api/reference#aspsps-get
   */
  async getASPSPs(): Promise<ASPSP[]> {
    try {
      const response = await this.client.get<ASPSPsResponse>('/aspsps', {
        headers: this.getAuthHeaders(),
      });
      return response.data.aspsps;
    } catch (error) {
      this.handleApiError(error, 'getASPSPs');
    }
  }

  /**
   * Start authorization flow
   * Returns URL for user to authorize access
   * @link https://enablebanking.com/docs/api/reference#auth-post
   */
  async startAuthorization(request: StartAuthorizationRequest): Promise<StartAuthorizationResponse> {
    try {
      const response = await this.client.post<StartAuthorizationResponse>('/auth', request, {
        headers: this.getAuthHeaders(),
      });
      return response.data;
    } catch (error) {
      // User-side misconfig: their Enable Banking app's redirect URL allowlist
      // doesn't include the URL we sent. Surface as a validation error so it
      // reaches the user instead of crashing into Sentry.
      if (axios.isAxiosError(error) && error.response?.data?.error === 'REDIRECT_URI_NOT_ALLOWED') {
        throw new ValidationError({
          message: t({
            key: 'bankDataProviders.enableBanking.redirectUriNotAllowed',
            variables: { redirectUrl: request.redirect_url },
          }),
        });
      }
      this.handleApiError(error, 'startAuthorization');
    }
  }

  /**
   * Create session from authorization code
   * @link https://enablebanking.com/docs/api/reference#sessions-post
   */
  async createSession(request: CreateSessionRequest): Promise<CreateSessionResponse> {
    try {
      const response = await this.client.post<CreateSessionResponse>('/sessions', request, {
        headers: this.getAuthHeaders(),
      });
      return response.data;
    } catch (error) {
      this.handleApiError(error, 'createSession');
    }
  }

  /**
   * Get session details
   * @link https://enablebanking.com/docs/api/reference#sessions-sessionid-get
   */
  async getSession(sessionId: string): Promise<SessionDetails> {
    try {
      const response = await this.client.get<SessionDetails>(`/sessions/${sessionId}`, {
        headers: this.getAuthHeaders(),
      });
      return response.data;
    } catch (error) {
      this.handleApiError(error, 'getSession');
    }
  }

  /**
   * Delete session (revoke consent)
   * @link https://enablebanking.com/docs/api/reference#sessions-sessionid-delete
   */
  async deleteSession(sessionId: string): Promise<void> {
    try {
      await this.client.delete(`/sessions/${sessionId}`, {
        headers: this.getAuthHeaders(),
      });
    } catch (error) {
      // Already-closed = nothing to revoke. Swallow the 400 so handleApiError
      // doesn't log + throw on every reauthorize that follows a stale session.
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data as { error?: unknown } | undefined;
        if (status === 400 && data?.error === 'CLOSED_SESSION') {
          logger.info(
            `[EnableBankingApiClient] deleteSession: session ${sessionId} already closed upstream; treating as success`,
          );
          return;
        }
      }
      this.handleApiError(error, 'deleteSession');
    }
  }

  /**
   * Get account details
   * @link https://enablebanking.com/docs/api/reference#accounts-accountid-details-get
   */
  async getAccountDetails(accountId: string): Promise<EnableBankingAccount> {
    try {
      const response = await this.client.get<EnableBankingAccount>(`/accounts/${accountId}/details`, {
        headers: this.getAuthHeaders(),
      });
      return response.data;
    } catch (error) {
      this.handleApiError(error, 'getAccountDetails');
    }
  }

  /**
   * Get account balances
   * @link https://enablebanking.com/docs/api/reference#accounts-accountid-balances-get
   */
  async getAccountBalances(accountId: string): Promise<EnableBankingBalance[]> {
    try {
      const response = await this.client.get<{ balances: EnableBankingBalance[] }>(`/accounts/${accountId}/balances`, {
        headers: this.getAuthHeaders(),
      });
      return response.data.balances;
    } catch (error) {
      this.handleApiError(error, 'getAccountBalances');
    }
  }

  /**
   * Get account transactions with pagination support
   * @link https://enablebanking.com/docs/api/reference#accounts-accountid-transactions-get
   */
  async getAccountTransactions(accountId: string, query?: TransactionsQuery): Promise<HalTransactions> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const response = await this.client.get<HalTransactions>(`/accounts/${accountId}/transactions`, {
          headers: this.getAuthHeaders(),
          params: query,
        });
        return response.data;
      } catch (error) {
        lastError = error;
        if (attempt < RETRY_DELAYS_MS.length && isRetryableAxiosError(error)) {
          await sleep(RETRY_DELAYS_MS[attempt]!);
          continue;
        }
        break;
      }
    }
    this.handleApiError(lastError, 'getAccountTransactions');
  }

  /**
   * Fetch all transactions with automatic pagination
   * Continues fetching until no more continuation_key is returned
   */
  async getAllTransactions(
    accountId: string,
    query?: Omit<TransactionsQuery, 'continuation_key'>,
  ): Promise<HalTransactions['transactions']> {
    const allTransactions: HalTransactions['transactions'] = [];
    let continuationKey: string | undefined;

    do {
      const response = await this.getAccountTransactions(accountId, {
        ...query,
        continuation_key: continuationKey,
      });

      allTransactions.push(...response.transactions);
      continuationKey = response.continuation_key;
    } while (continuationKey);

    return allTransactions;
  }
}
