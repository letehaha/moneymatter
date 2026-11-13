import { t } from '@i18n/index';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  TooManyRequests,
  ValidationError,
} from '@js/errors';
import { logger } from '@js/utils/logger';
import axios, { AxiosInstance } from 'axios';

import { SimplefinAccountSet, SimplefinGetAccountsParams } from './types';

// The bridge answers a full /accounts call only after polling every institution, which can exceed 30s.
const ACCOUNTS_REQUEST_TIMEOUT_MS = 300_000;
const CLAIM_REQUEST_TIMEOUT_MS = 30_000;

/** Protocol version we request — v2 gives structured `errlist` + `connections`. */
const SIMPLEFIN_PROTOCOL_VERSION = 2;

/** Convert a JS Date to the UNIX epoch SECONDS that SimpleFIN expects. */
const toEpochSeconds = (date: Date): number => Math.floor(date.getTime() / 1000);

/**
 * SimpleFIN Bridge API client.
 *
 * Handles HTTP communication with a SimpleFIN server. The Access URL carries
 * HTTP Basic credentials inline (`https://<user>:<pass>@host/path`); we strip
 * them into an axios `auth` config so they never appear in a logged URL.
 *
 * Protocol reference: https://www.simplefin.org/protocol.html
 */
export class SimplefinApiClient {
  private client: AxiosInstance;

  constructor(accessUrl: string) {
    let parsed: URL;
    try {
      parsed = new URL(accessUrl);
    } catch {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.simplefin.invalidAccessUrl' }) });
    }

    const username = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);

    // Rebuild the base URL without the embedded credentials.
    parsed.username = '';
    parsed.password = '';
    const baseURL = parsed.toString().replace(/\/+$/, '');

    this.client = axios.create({
      baseURL,
      auth: { username, password },
      timeout: ACCOUNTS_REQUEST_TIMEOUT_MS,
    });
  }

  /**
   * Exchange a one-time setup token for a long-lived Access URL.
   *
   * The token is a base64-encoded claim URL; POSTing to it returns the Access
   * URL as a plain-text body. The token is single-use — a second claim fails.
   */
  static async claimAccessUrl(setupToken: string): Promise<string> {
    let claimUrl: string;
    try {
      claimUrl = Buffer.from(setupToken, 'base64').toString('utf-8').trim();
    } catch {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.simplefin.invalidSetupToken' }) });
    }

    if (!/^https?:\/\//i.test(claimUrl)) {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.simplefin.invalidSetupToken' }) });
    }

    try {
      // SimpleFIN requires an empty body with explicit zero Content-Length.
      const response = await axios.post(claimUrl, null, {
        headers: { 'Content-Length': 0 },
        timeout: CLAIM_REQUEST_TIMEOUT_MS,
        responseType: 'text',
      });
      const accessUrl = String(response.data).trim();

      if (!/^https?:\/\//i.test(accessUrl)) {
        throw new ValidationError({ message: t({ key: 'bankDataProviders.simplefin.claimFailed' }) });
      }

      return accessUrl;
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        logger.info(`[SimplefinApiClient] claimAccessUrl failed: status=${status}`);
        // 403 is the protocol's signal that the token is nonexistent or already
        // claimed — the genuine "bad token" case.
        if (status === 403) {
          throw new ForbiddenError({ message: t({ key: 'bankDataProviders.simplefin.invalidSetupToken' }) });
        }
        // 429: the bridge is rate-limiting the claim. The token is likely fine —
        // don't tell the user it's invalid (it's single-use, they'd waste it).
        if (status === 429) {
          throw new TooManyRequests({ message: t({ key: 'bankDataProviders.simplefin.rateLimited' }) });
        }
        // Other 4xx (e.g. malformed request) — a client problem, but not an
        // "invalid token". 5xx / network errors fall through and propagate.
        if (status && status >= 400 && status < 500) {
          throw new BadRequestError({
            message: t({
              key: 'bankDataProviders.apiError',
              variables: { provider: 'SimpleFIN', message: error.message },
            }),
          });
        }
      }
      throw error;
    }
  }

  /**
   * Returns false only for a gen.auth errlist entry, the one code meaning our Access URL is rejected.
   * con.auth is scoped to one institution and leaves the credentials valid.
   * Other failures propagate so 5xx and network errors stay distinguishable from bad credentials.
   */
  async testConnection(): Promise<boolean> {
    const accountSet = await this.getAccounts({ balancesOnly: true });
    return !(accountSet.errlist ?? []).some((entry) => entry.code === 'gen.auth');
  }

  /**
   * GET /accounts — account info and (optionally) transactions for a window.
   */
  async getAccounts(params: SimplefinGetAccountsParams = {}): Promise<SimplefinAccountSet> {
    // `version=2` is required by the bridge for the structured-error / connection
    // response shape; without it the server may fall back to the v1 schema.
    const query: Record<string, string | number> = { version: SIMPLEFIN_PROTOCOL_VERSION };

    if (params.startDate) query['start-date'] = toEpochSeconds(params.startDate);
    if (params.endDate) query['end-date'] = toEpochSeconds(params.endDate);
    if (params.accountId) query['account'] = params.accountId;
    if (params.balancesOnly) query['balances-only'] = 1;

    try {
      const response = await this.client.get<SimplefinAccountSet>('/accounts', { params: query });
      return response.data;
    } catch (error) {
      this.handleApiError(error, 'getAccounts');
    }
  }

  /**
   * Map raw axios errors to typed application errors. Does not log here so
   * callers handling errors gracefully don't generate duplicate Sentry events.
   */
  private handleApiError(error: unknown, method: string): never {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;

      logger.info(`[SimplefinApiClient] ${method} failed: status=${status} code=${error.code}`);

      // The Access URL host is user-supplied, so the client message stays fixed:
      // axios text would reveal which internal hosts resolve or refuse connections.
      if (!status || status >= 500) {
        throw new ServiceUnavailableError({ message: t({ key: 'bankDataProviders.simplefinUnreachable' }) });
      }

      if (status === 401 || status === 403) {
        throw new ForbiddenError({ message: t({ key: 'bankDataProviders.simplefin.invalidAccessUrl' }) });
      } else if (status === 429) {
        // Rate-limited (the bridge disables tokens for excessive requests).
        // Distinct from auth so the connection is NOT deactivated for a
        // transient throttle — see SimplefinProvider.isAuthError.
        throw new TooManyRequests({ message: t({ key: 'bankDataProviders.simplefin.rateLimited' }) });
      } else if (status === 404) {
        throw new NotFoundError({ message: t({ key: 'bankDataProviders.simplefin.accountNotFound' }) });
      } else if (status >= 400) {
        throw new BadRequestError({
          message: t({
            key: 'bankDataProviders.apiError',
            variables: { provider: 'SimpleFIN', message: error.message },
          }),
        });
      }
    }

    throw error;
  }
}
