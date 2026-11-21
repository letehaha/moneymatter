import {
  ExternalMonobankClientInfoResponse,
  ExternalMonobankTransactionResponse,
} from '@bt/shared/types/external-services';
import { t } from '@i18n/index';
import { BadRequestError, ForbiddenError, NotFoundError, TooManyRequests } from '@js/errors';
import { CacheClient } from '@js/utils/cache';
import { logger } from '@js/utils/logger';
import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';

import { isGeoBlockResponseBody, isUnknownAccountResponse } from './error-signatures';

/**
 * Marker thrown when Monobank's edge (AWS ELB) rejects the request with a
 * plain-text 403 telling the user to disable VPN / change IP. Distinct from
 * an invalid-token ForbiddenError so the worker can skip the retry — the IP
 * isn't going to change between attempts.
 */
export class MonobankGeoBlockedError extends ForbiddenError {
  public readonly isGeoBlocked = true as const;
}

/**
 * Marker thrown when Monobank does not recognise the stored external account
 * id. The worker skips the retry: the id is stale until the user reconnects,
 * so a second attempt 60s later only burns the token's rate-limit slot.
 */
export class MonobankAccountNotFoundError extends NotFoundError {
  public readonly isAccountNotFound = true as const;
}

/**
 * Monobank API client
 * Handles all HTTP communication with Monobank's API
 *
 * API Documentation: https://api.monobank.ua/docs/
 */
export class MonobankApiClient {
  private readonly baseURL = 'https://api.monobank.ua';
  private client: AxiosInstance;
  private apiToken: string;
  private cache: CacheClient<ExternalMonobankClientInfoResponse>;
  private tokenHash: string;

  constructor(apiToken: string) {
    this.apiToken = apiToken;
    // Create a hash of the token for cache key (don't store raw token in cache keys)
    this.tokenHash = crypto.createHash('sha256').update(apiToken).digest('hex').slice(0, 16);
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'X-Token': this.apiToken,
      },
      timeout: 30000, // 30 seconds
    });
    // Cache client info for 15 minutes (900 seconds)
    this.cache = new CacheClient<ExternalMonobankClientInfoResponse>({
      ttl: 900,
      logPrefix: 'MonobankClientInfo',
    });
  }

  /**
   * Get client information and accounts (cached version)
   * Rate limit: once per 60 seconds
   * Cache: 15 minutes
   *
   * @param bypassCache - If true, skip cache and fetch fresh data
   * @returns Client info with accounts
   * @link https://api.monobank.ua/docs/#tag/Kliyentski-personalni-dani/paths/~1personal~1client-info/get
   */
  async getClientInfo({
    bypassCache = false,
  }: { bypassCache?: boolean } = {}): Promise<ExternalMonobankClientInfoResponse> {
    const cacheKey = `monobank:client-info:${this.tokenHash}`;

    // Try to get from cache first (unless bypassing cache)
    if (!bypassCache) {
      const cached = await this.cache.read(cacheKey);
      if (cached) {
        logger.info('[MonobankApiClient] Returning cached client info');
        return cached;
      }
    }

    // Fetch fresh data
    try {
      const response = await this.client.get<ExternalMonobankClientInfoResponse>('/personal/client-info');

      // Store in cache
      await this.cache.write({ key: cacheKey, value: response.data });

      return response.data;
    } catch (error) {
      this.handleApiError(error, 'getClientInfo');
    }
  }

  /**
   * Get account statement (transactions) for a specific account
   * Rate limit: once per 60 seconds
   *
   * @param accountId - Account ID from Monobank
   * @param from - Start timestamp (Unix seconds)
   * @param to - End timestamp (Unix seconds)
   * @returns Array of transactions
   * @link https://api.monobank.ua/docs/#tag/Kliyentski-personalni-dani/paths/~1personal~1statement~1{account}~1{from}~1{to}/get
   */
  async getStatement(accountId: string, from: number, to: number): Promise<ExternalMonobankTransactionResponse[]> {
    try {
      const response = await this.client.get<ExternalMonobankTransactionResponse[]>(
        `/personal/statement/${accountId}/${from}/${to}`,
      );
      return response.data;
    } catch (error) {
      this.handleApiError(error, 'getStatement');
    }
  }

  /**
   * Handle API errors with proper logging and throw appropriate custom errors
   * @param error - Error object from axios
   * @param method - API method name for logging
   */
  private handleApiError(error: unknown, method: string): never {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const errorDescription = error.response?.data?.errorDescription;

      // `responseBody` carries whatever Monobank actually returned, which is
      // the only way to tell a revoked token from an anti-fraud block /
      // IP block / unknown-body 403.
      const responseDetails = {
        status,
        errorDescription,
        axiosMessage: error.message,
        axiosCode: error.code,
        url: error.config?.url,
        httpMethod: error.config?.method,
        responseBody: error.response?.data,
        responseHeaders: error.response?.headers,
      };

      // Handle specific error cases with proper error types. A revoked/mistyped
      // token and a rate-limit are expected user/provider outcomes surfaced to
      // the caller as typed 4xx errors, so they log at info and stay out of
      // Sentry; everything else logs at a Sentry-visible level below.
      if (status === 403 && isGeoBlockResponseBody(error.response?.data)) {
        logger.warn(`[MonobankApiClient] Geo-blocked (VPN / non-UA IP) in ${method}`, responseDetails);
        // Dev runs locally — surface the actionable "disable VPN" hint.
        // Prod runs on a VPS the end-user can't reconfigure, so a "we know,
        // contact support" message is more honest. The warn above keeps
        // Sentry visibility, since in prod a geo-block means our server's IP
        // got blocked.
        const geoBlockedKey =
          process.env.NODE_ENV === 'production'
            ? 'bankDataProviders.monobank.geoBlockedProduction'
            : 'bankDataProviders.monobank.geoBlocked';
        throw new MonobankGeoBlockedError({ message: t({ key: geoBlockedKey }) });
      } else if (errorDescription === "Unknown 'X-Token'") {
        logger.info(`[MonobankApiClient] Invalid API token used in ${method}`, responseDetails);
        throw new ForbiddenError({ message: t({ key: 'bankDataProviders.monobank.invalidApiToken' }) });
      } else if (isUnknownAccountResponse({ status, errorDescription })) {
        logger.info(`[MonobankApiClient] Unknown external account id in ${method}`, responseDetails);
        throw new MonobankAccountNotFoundError({
          message: t({ key: 'bankDataProviders.monobank.accountReconnectRequired' }),
        });
      } else if (status === 429) {
        logger.info(`[MonobankApiClient] Rate limit exceeded in ${method}`, responseDetails);
        throw new TooManyRequests({
          message: t({ key: 'bankDataProviders.monobank.rateLimitExceeded' }),
          details: { provider: 'monobank' },
        });
      }

      // `message:` in winston extras gets spread on top of the log record and
      // would overwrite the message field — raw axios text lives under
      // `axiosMessage` in the details so the prefix survives.
      logger.error({ message: `[MonobankApiClient] ${method} failed`, error: error as Error }, responseDetails);

      if (status && status >= 400) {
        throw new BadRequestError({
          message:
            errorDescription ||
            t({
              key: 'bankDataProviders.apiError',
              variables: { provider: 'Monobank', message: error.message },
            }),
        });
      }
    }

    logger.error({ message: `[MonobankApiClient] ${method} unexpected error:`, error: error as Error });
    throw error;
  }

  /**
   * Test if the API token is valid.
   * Returns false only for a genuine auth failure (Monobank returns 403 with
   * "Unknown 'X-Token'", which `handleApiError` converts to ForbiddenError).
   * Network/5xx/429 errors propagate so callers can distinguish "invalid token"
   * from "provider is down".
   */
  async testConnection(): Promise<boolean> {
    try {
      // Bypass cache: this is a live connectivity check, not a data read.
      // A stale cache hit would falsely report a now-invalid token as valid.
      await this.getClientInfo({ bypassCache: true });
      return true;
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return false;
      }
      throw error;
    }
  }
}
