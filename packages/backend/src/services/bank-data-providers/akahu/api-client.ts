import { t } from '@i18n/index';
import { BadRequestError, ForbiddenError, NotFoundError, ServiceUnavailableError } from '@js/errors';
import { logger } from '@js/utils/logger';
import axios, { AxiosInstance } from 'axios';

import type {
  AkahuApiAccountResponse,
  AkahuApiAccountsResponse,
  AkahuApiMe,
  AkahuApiTransaction,
  AkahuApiTransactionsResponse,
  AkahuCredentials,
} from './types';

export class AkahuApiClient {
  private readonly baseURL = 'https://api.akahu.io/v1';
  private client: AxiosInstance;

  constructor(credentials: AkahuCredentials) {
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        Authorization: `Bearer ${credentials.userToken}`,
        'X-Akahu-Id': credentials.appToken,
      },
      timeout: 30000,
    });
  }

  /**
   * Returns false only for invalid tokens; outages propagate so callers can
   * tell "bad tokens" from "Akahu is down".
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getMe();
      return true;
    } catch (error) {
      if (error instanceof ForbiddenError) return false;
      throw error;
    }
  }

  async getMe(): Promise<AkahuApiMe> {
    try {
      const response = await this.client.get<AkahuApiMe>('/me');
      return response.data;
    } catch (error) {
      this.handleApiError(error, 'getMe');
    }
  }

  async getAccounts(): Promise<AkahuApiAccountsResponse> {
    try {
      const response = await this.client.get<AkahuApiAccountsResponse>('/accounts');
      return response.data;
    } catch (error) {
      this.handleApiError(error, 'getAccounts');
    }
  }

  async getAccount({ accountId }: { accountId: string }): Promise<AkahuApiAccountResponse> {
    try {
      const response = await this.client.get<AkahuApiAccountResponse>(`/accounts/${accountId}`);
      return response.data;
    } catch (error) {
      this.handleApiError(error, 'getAccount');
    }
  }

  /** `start` is exclusive and `end` inclusive on the transaction `date`. */
  async getTransactions({
    accountId,
    start,
    end,
  }: {
    accountId: string;
    start?: Date;
    end?: Date;
  }): Promise<AkahuApiTransaction[]> {
    const all: AkahuApiTransaction[] = [];
    let cursor: string | null = null;

    do {
      const params: Record<string, string> = {};
      if (start) params.start = start.toISOString();
      if (end) params.end = end.toISOString();
      if (cursor) params.cursor = cursor;

      let response: AkahuApiTransactionsResponse;
      try {
        const res = await this.client.get<AkahuApiTransactionsResponse>(`/accounts/${accountId}/transactions`, {
          params,
        });
        response = res.data;
      } catch (error) {
        this.handleApiError(error, 'getTransactions');
      }

      all.push(...response.items);
      cursor = response.cursor?.next ?? null;
    } while (cursor);

    return all;
  }

  /**
   * Never throws: a failed refresh must not fail the sync, which reads cached data.
   * 429 means the manual-refresh rest period (up to 1h) has not passed yet.
   */
  async requestRefresh({ accountId }: { accountId: string }): Promise<void> {
    try {
      // The `{}` body makes axios send `Content-Type: application/json`, which Akahu requires.
      await this.client.post(`/refresh/${accountId}`, {});
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const message = (axios.isAxiosError(error) && error.response?.data?.message) || (error as Error).message;

      if (status === 429) {
        logger.info(`[AkahuApiClient] requestRefresh throttled: ${message}`);
        return;
      }
      logger.error({ message: `[AkahuApiClient] requestRefresh failed: status=${status}, message=${message}` });
    }
  }

  private handleApiError(error: unknown, method: string): never {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const errorMessage = error.response?.data?.message;

      logger.info(`[AkahuApiClient] ${method} failed: status=${status}, errorMessage=${errorMessage}`);

      if (!status || status >= 500) {
        throw new ServiceUnavailableError({
          message: t({ key: 'bankDataProviders.apiError', variables: { provider: 'Akahu', message: error.message } }),
        });
      } else if (status === 401 || status === 403) {
        // 403 usually means the required X-Akahu-Id header was rejected.
        throw new ForbiddenError({
          message: errorMessage || t({ key: 'bankDataProviders.akahu.invalidTokens' }),
        });
      } else if (status === 404) {
        throw new NotFoundError({
          message: errorMessage || t({ key: 'bankDataProviders.akahu.accountNotFound' }),
        });
      } else if (status === 429) {
        throw new ServiceUnavailableError({
          message: errorMessage || t({ key: 'bankDataProviders.akahu.rateLimited' }),
        });
      } else {
        throw new BadRequestError({
          message:
            errorMessage ||
            t({
              key: 'bankDataProviders.apiError',
              variables: { provider: 'Akahu', message: error.message },
            }),
        });
      }
    }

    throw error;
  }
}
