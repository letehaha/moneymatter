import { ensureChunkLoaded, i18n } from '@/i18n';

import { FETCH_NETWORK_FAILURE_MESSAGES, NetworkError } from './network.error';
import { UnexpectedError } from './unexpected.error';

const TOO_MANY_REQUESTS_STATUS = 429;

const SHARED_CODE_KEYS: Record<string, string> = {
  SESSION_EXPIRED: 'errors.auth.reauthenticationRequired',
  PASSWORD_TOO_SHORT: 'errors.auth.passwordTooShort',
  PASSWORD_TOO_LONG: 'errors.auth.passwordTooLong',
  PROVIDER_NOT_FOUND: 'errors.auth.providerNotConfigured',
  SOCIAL_ACCOUNT_ALREADY_LINKED: 'errors.auth.accountAlreadyLinked',
  LINKED_ACCOUNT_ALREADY_EXISTS: 'errors.auth.accountAlreadyLinked',
  FAILED_TO_UNLINK_LAST_ACCOUNT: 'errors.auth.cannotUnlinkLastAccount',
  PREVIOUSLY_REGISTERED: 'errors.auth.passkeyAlreadyRegistered',
};

/**
 * Reads `{ code, status }` off a better-auth `result.error`, an `UnexpectedError` carrying one
 * in `data`, or an app-owned auth route error whose code sits under `response`.
 */
const readAuthError = ({ error }: { error: unknown }): { code?: string; status?: number } => {
  const source = error instanceof UnexpectedError ? error.data : error;
  if (!source || typeof source !== 'object') return {};

  const { code, status, response } = source as { code?: unknown; status?: unknown; response?: { code?: unknown } };
  const resolvedCode = typeof code === 'string' ? code : response?.code;

  return {
    code: typeof resolvedCode === 'string' ? resolvedCode : undefined,
    status: typeof status === 'number' ? status : undefined,
  };
};

const isNetworkFailure = ({ error }: { error: unknown }) =>
  error instanceof NetworkError ||
  (error instanceof TypeError && FETCH_NETWORK_FAILURE_MESSAGES.some((message) => error.message.includes(message)));

export const getAuthErrorKey = ({
  error,
  codeKeys = {},
  fallbackKey,
}: {
  error: unknown;
  codeKeys?: Record<string, string>;
  fallbackKey: string;
}): string => {
  if (isNetworkFailure({ error })) return 'errors.api.failedToFetch';

  const { code, status } = readAuthError({ error });
  if (status === 0) return 'errors.api.failedToFetch';
  if (status === TOO_MANY_REQUESTS_STATUS) return 'errors.api.tooManyRequests';

  return (code && (codeKeys[code] ?? SHARED_CODE_KEYS[code])) || fallbackKey;
};

/**
 * Translated message for a failed better-auth call. Never returns better-auth's or the
 * browser's English text: unknown codes resolve to `fallbackKey`. `params` feed every key.
 */
export const getAuthErrorMessage = async ({
  error,
  codeKeys,
  fallbackKey,
  params = {},
}: {
  error: unknown;
  codeKeys?: Record<string, string>;
  fallbackKey: string;
  params?: Record<string, unknown>;
}): Promise<string> => {
  const key = getAuthErrorKey({ error, codeKeys, fallbackKey });
  // Auth pages don't load the `errors` chunk with their route.
  if (key.startsWith('errors.')) await ensureChunkLoaded('errors');
  return i18n.global.t(key, params);
};
