import { API_HTTP, API_VER } from '@/api/api-base-url';
import { ApiBaseError } from '@/common/types';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useBaseCurrencyChangeStatus } from '@/composable/use-base-currency-change-status';
import { useImportBatchDeleteJobStatus } from '@/composable/use-import-batch-delete-job-status';
import { useRestoreJobStatus } from '@/composable/use-restore-job-status';
import { getCurrentLocale, i18n } from '@/i18n';
import * as errors from '@/js/errors';
import { router } from '@/routes';
import { ROUTES_NAMES } from '@/routes/constants';
import { useAuthStore } from '@/stores';
import type { BaseCurrencyChangeStatus } from '@bt/shared/types';
import { API_ERROR_CODES, API_RESPONSE_STATUS } from '@bt/shared/types/api';

type HTTP_METHOD = 'PATCH' | 'POST' | 'PUT' | 'GET' | 'DELETE';
const SESSION_ID_HEADER_KEY = 'X-Session-ID';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiValidResponse = any;

interface ApiRequestConfig {
  method: HTTP_METHOD;
  headers: {
    'Content-Type': string;
    [SESSION_ID_HEADER_KEY]: string;
    'Accept-Language': string;
    [header: string]: string;
  };
  body?: BodyInit;
  credentials: RequestCredentials;
  signal?: AbortSignal;
}

interface ApiCall {
  endpoint: string;
  method: HTTP_METHOD;
  query?: Record<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: Record<string | number, any>;
  /**
   * Body sent to `fetch` verbatim, without JSON encoding. Used for binary
   * uploads (a `File`/`Blob`) that must not be copied into a string first —
   * a multi-megabyte file would otherwise be held in memory twice.
   * Takes precedence over `data`.
   */
  rawBody?: BodyInit;
  /** Request headers merged over the defaults (Content-Type, session, locale). */
  headers?: Record<string, string>;
  options?: {
    needRaw?: boolean;
    /** When true, suppresses error toast notifications for failed requests */
    silent?: boolean;
    /** AbortSignal forwarded to fetch – lets callers cancel in-flight requests. */
    signal?: AbortSignal;
  };
}

export { API_HTTP } from './api-base-url';
const SESSION_ID_KEY = 'session-id';

// Distinguishes the managed cloud deployment from local/self-host setups.
// We only want to show the verbose "is the backend running / check ALLOWED_ORIGINS"
// hint to operators – for cloud users a network failure is almost always transient
// and the technical hint would be more confusing than helpful.
const CLOUD_HOSTNAME = 'moneymatter.app';
const isCloudDeployment = (): boolean => {
  const hostname = window.location.hostname;
  return hostname === CLOUD_HOSTNAME || hostname.endsWith(`.${CLOUD_HOSTNAME}`);
};

/** Translated text with a literal fallback, for the window before the i18n chunk is loaded. */
const t = (key: string, fallback: string): string => {
  const translated = i18n.global.t(key);
  return translated === key ? fallback : translated;
};

const PLAN_REQUIRED_NOTIFICATION_ID = 'plan-required-error';
const BACKGROUND_JOB_POLL_MS = 2000;

/** Persistent toast for a 402: the user cannot retry the action without picking a plan. */
export const notifyPlanRequired = ({ message }: { message: string }) => {
  const { addNotification, removeNotification } = useNotificationCenter();

  addNotification({
    id: PLAN_REQUIRED_NOTIFICATION_ID,
    text: message,
    type: NotificationType.error,
    persistent: true,
    action: {
      label: t('billing.seePlans', 'See plans'),
      onClick: () => {
        removeNotification(PLAN_REQUIRED_NOTIFICATION_ID);
        router.push({ name: ROUTES_NAMES.settingsPlanBilling });
      },
    },
  });
};

/**
 * API client for making requests to the backend.
 * Authentication is handled via session cookies (managed by better-auth).
 */
class ApiCaller {
  get<T = Record<string, unknown>>(
    endpoint: ApiCall['endpoint'],
    query: T = {} as T,
    options: ApiCall['options'] = {},
  ) {
    const validQuery: ApiCall['query'] = {};

    for (const key in query) {
      if (query[key]) {
        validQuery[key] = query[key]?.toString() ?? '';
      }
    }

    return this._call({
      method: 'GET',
      endpoint,
      options,
      query: validQuery,
    });
  }

  post(endpoint: ApiCall['endpoint'], data: ApiCall['data'] = undefined, options: ApiCall['options'] = {}) {
    return this._call({
      method: 'POST',
      endpoint,
      options,
      data,
    });
  }

  /**
   * POSTs a body straight to the endpoint with no JSON encoding — for binary
   * uploads. Pass the matching `Content-Type` in `headers`; anything else there
   * is merged over the defaults too.
   */
  postRaw({
    endpoint,
    body,
    query,
    headers,
    options = {},
  }: {
    endpoint: ApiCall['endpoint'];
    body: BodyInit;
    query?: ApiCall['query'];
    headers?: Record<string, string>;
    options?: ApiCall['options'];
  }) {
    return this._call({
      method: 'POST',
      endpoint,
      options,
      query,
      rawBody: body,
      headers,
    });
  }

  patch(endpoint: ApiCall['endpoint'], data: ApiCall['data'] = undefined, options: ApiCall['options'] = {}) {
    return this._call({
      method: 'PATCH',
      endpoint,
      options,
      data,
    });
  }

  put(endpoint: ApiCall['endpoint'], data: ApiCall['data'] = undefined, options: ApiCall['options'] = {}) {
    return this._call({
      method: 'PUT',
      endpoint,
      options,
      data,
    });
  }

  delete<TQuery = Record<string, unknown>, TData = Record<string, unknown>>(
    endpoint: ApiCall['endpoint'],
    params?: {
      query?: TQuery;
      data?: TData;
    },
    options: ApiCall['options'] = {},
  ) {
    const validQuery: ApiCall['query'] = {};

    if (params?.query) {
      for (const key in params.query) {
        if (params.query[key]) {
          validQuery[key] = params.query[key]?.toString() ?? '';
        }
      }
    }

    return this._call({
      method: 'DELETE',
      endpoint,
      options,
      query: validQuery,
      data: params?.data as ApiCall['data'],
    });
  }

  /**
   * Performs a request
   *
   * @param {object} opts
   * @param {string} opts.endpoint - endpoint where to make the call to, e.g. `/accounts`
   * @param {object} opts.data - request data (for POST/PUT requests)
   * @param {object} opts.query - request query params. See {@link parseQuery} for details
   * @param {string} opts.method - the http method of request
   * @param {boolean} opts.options.needRaw - defines if raw response should be
   * returned, `true` by default
   *
   * @private
   */
  async _call(opts: ApiCall): Promise<ApiValidResponse> {
    // TypeScript is dump and things that URLSearchParams only records with string-only
    // values, but it's not
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let additionalParams = new URLSearchParams(opts.query as any).toString();

    if (additionalParams) {
      additionalParams = `?${additionalParams}`;
    }
    const url = `${API_HTTP}${API_VER}${opts.endpoint}${additionalParams}`;
    const config: ApiRequestConfig = {
      method: opts.method,
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': window.sessionStorage?.getItem(SESSION_ID_KEY) || '',
        'Accept-Language': getCurrentLocale(), // Send current locale to backend
        ...opts.headers,
      },
      // Include credentials (cookies) for session-based authentication
      credentials: 'include',
    };

    if (opts.rawBody !== undefined) {
      config.body = opts.rawBody;
    } else if (opts.data) {
      config.body = JSON.stringify(opts.data);
    }

    if (opts.options?.signal) {
      config.signal = opts.options.signal;
    }

    let result: Response;

    const { addNotification } = useNotificationCenter();

    const isSilent = opts.options?.silent ?? false;

    try {
      result = await fetch(url, config);
    } catch (e) {
      // Caller-initiated abort (signal) – rethrow silently so the caller can
      // discard the in-flight request without showing a network error toast.
      if (e instanceof DOMException && e.name === 'AbortError') {
        throw e;
      }
      if (e instanceof TypeError && errors.FETCH_NETWORK_FAILURE_MESSAGES.some((msg) => e.message.includes(msg))) {
        // Self-hosters and local devs are the system operators – give them the
        // actionable hint (backend not running, CORS misconfigured). Cloud users
        // can't act on either and should see a generic message.
        const message = isCloudDeployment()
          ? t('errors.api.failedToFetch', 'Failed to connect to server')
          : t(
              'errors.api.failedToFetchSelfHost',
              'Cannot reach the server. The backend may still be starting (~30s after startup), or your ALLOWED_ORIGINS env var does not include this URL.',
            );
        if (!isSilent) {
          addNotification({
            id: 'api-fetching-error',
            text: message,
            type: NotificationType.error,
          });
        }

        throw new errors.NetworkError(message);
      }

      const message = t('errors.api.unexpectedError', 'An unexpected error occurred');
      if (!isSilent) {
        addNotification({
          id: 'unexpected-api-error',
          text: message,
          type: NotificationType.error,
        });
      }

      throw new errors.UnexpectedError(message, {});
    }

    const sessionId = result.headers.get(SESSION_ID_HEADER_KEY);

    if (sessionId) window.sessionStorage?.setItem(SESSION_ID_KEY, sessionId);

    // Handle empty response from backend. Only treat an empty body as success
    // when the response status itself is ok – a non-ok empty body (e.g. a
    // proxy-level 503 with no payload) must fall through to the JSON parsing
    // below, whose catch block builds a proper ApiErrorResponseError for
    // bodies that aren't valid JSON.
    if (result.ok && (result.headers.get('content-length') === '0' || result.status === 204)) {
      return undefined;
    }

    let parsed: {
      status: API_RESPONSE_STATUS;
      response: ApiBaseError | ApiValidResponse;
    };

    try {
      parsed = await result.json();
    } catch {
      // Response body is not JSON. Happens for raw infrastructure errors that
      // never reach our `apiResponseMiddleware` envelope – e.g. body-parser's
      // 413 Payload Too Large (plain text) or a gateway HTML 5xx page.
      // Without this, `result.json()` throws a SyntaxError that escapes to the
      // caller and surfaces as "Unexpected token <".
      const message =
        result.status === 413
          ? t('errors.api.payloadTooLarge', 'The request is too large. Please try importing fewer items at a time')
          : `${result.status} ${result.statusText}`.trim() ||
            t('errors.api.unexpectedError', 'An unexpected error occurred');

      throw new errors.ApiErrorResponseError(message, {
        code: result.status === 413 ? API_ERROR_CODES.payloadTooLarge : API_ERROR_CODES.unexpected,
        message,
        statusText: result.statusText,
      });
    }

    const { status, response } = parsed;

    if (status === API_RESPONSE_STATUS.success) {
      // Long AI calls run as server-side jobs, so a browser or proxy timeout cannot cut them off.
      if (result.status === 202 && response?.backgroundJobId) {
        await new Promise((resolve) => setTimeout(resolve, BACKGROUND_JOB_POLL_MS));
        return this._call({
          method: 'GET',
          endpoint: `/background-jobs/${response.backgroundJobId}`,
          options: opts.options,
        });
      }
      return response;
    }

    if (status === API_RESPONSE_STATUS.error) {
      if (response.code === API_ERROR_CODES.unauthorized) {
        // Tear down every blocking-job watchdog first: without a session their 2s status
        // polls would 401 on every tick. Each poll swallows the AuthError (assuming the
        // API handler already stopped it), so a still-running restore watchdog would
        // otherwise loop logout()/router.push forever and keep #app inert.
        useBaseCurrencyChangeStatus().stop();
        useRestoreJobStatus().stop();
        useImportBatchDeleteJobStatus().stop();

        useAuthStore().logout();

        router.push('/sign-in');

        addNotification({
          id: 'authorization-error',
          text: t('errors.api.sessionExpired', 'Your session has expired'),
          type: NotificationType.error,
        });

        throw new errors.AuthError(response, url);
      }

      if (response.code === API_ERROR_CODES.planRequired && !isSilent) {
        notifyPlanRequired({ message: response.message });
      }

      if (response.code === API_ERROR_CODES.baseCurrencyChangeInProgress) {
        // The base-currency write-lock is held server-side and rejected this mutation —
        // by a real base-currency change, a data restore, or a large import-batch delete,
        // which all grab the same lock. Engage every watchdog; each polls its own status
        // endpoint and self-dismisses if idle, so whichever job is actually running sticks.
        // Then still reject so callers unwind.
        const currencyWatch = useBaseCurrencyChangeStatus();
        if (!currencyWatch.isBlocking.value) {
          // The LockedError carries the live status in `details.status`; seeding it
          // skips the one-tick flash of a fabricated "queued" placeholder.
          const seed = response.details?.status;
          if (typeof seed?.state === 'string') {
            currencyWatch.start({ initialStatus: seed as BaseCurrencyChangeStatus });
          } else {
            currencyWatch.start();
          }
        }
        const restoreWatch = useRestoreJobStatus();
        if (!restoreWatch.isBlocking.value) {
          // No restore-specific status in the 423 payload, so use the boot check path: it
          // fetches the restore status first and only blocks if a restore is truly running
          // (idle → no-op, no fabricated "queued" flash).
          void restoreWatch.checkOnBoot();
        }
        const batchDeleteWatch = useImportBatchDeleteJobStatus();
        if (!batchDeleteWatch.isBlocking.value) {
          void batchDeleteWatch.checkOnBoot();
        }
      }

      if (response.code === API_ERROR_CODES.unexpected && !isSilent) {
        addNotification({
          id: 'unexpected-error',
          text: t('errors.api.unexpectedError', 'An unexpected error occurred'),
          type: NotificationType.error,
        });
      }

      throw new errors.ApiErrorResponseError(response.message, response);
    }

    return undefined;
  }
}

export const api = new ApiCaller();
