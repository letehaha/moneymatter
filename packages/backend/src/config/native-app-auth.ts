import { IOS_APP_ORIGIN, IOS_SELF_HOST_APP_ORIGIN } from '@common/const/ios-app-origin';
import { EnvVar, isEnvConfigured } from '@common/utils/env';
import { isSelfHost } from '@config/is-self-host';
import { createHash } from 'node:crypto';

/**
 * Never write this into `APPLE_APP_BUNDLE_IDENTIFIER`: device-token registration reads that
 * variable and would start accepting push tokens.
 */
export const APP_STORE_BUNDLE_ID = 'app.moneymatter.mobile';

export const APPLE_NONCE_ERROR = {
  invalid: 'APPLE_NONCE_INVALID',
  serverMismatch: 'APPLE_NONCE_SERVER_MISMATCH',
} as const;

type AppleNonceError = (typeof APPLE_NONCE_ERROR)[keyof typeof APPLE_NONCE_ERROR];

const HEX_64 = /^[0-9a-f]{64}$/;

/**
 * `host[:port]` of `baseUrl`, compared as a plain string with the value the iOS app computes from
 * the address the user typed. Empty when `baseUrl` has no host.
 */
export function resolveServerAuthority({ baseUrl }: { baseUrl: string }): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return '';
  }
  const host = url.hostname.replace(/\.$/, '');
  return url.port ? `${host}:${url.port}` : host;
}

/** Audience of native Apple ID tokens this server accepts; null when native Apple sign-in is off. */
export function resolveNativeAppleAudience({
  selfHost,
  bundleId,
  nativeSignIn,
}: {
  selfHost: boolean;
  bundleId: string | undefined;
  nativeSignIn: string | undefined;
}): string | null {
  if (nativeSignIn?.trim().toLowerCase() === 'false') return null;
  return bundleId ?? (selfHost ? APP_STORE_BUNDLE_ID : null);
}

export function getNativeAppleAudience(): string | null {
  const bundleId = process.env[EnvVar.APPLE_APP_BUNDLE_IDENTIFIER];
  return resolveNativeAppleAudience({
    selfHost: isSelfHost(),
    bundleId: isEnvConfigured(EnvVar.APPLE_APP_BUNDLE_IDENTIFIER, bundleId) ? bundleId : undefined,
    nativeSignIn: process.env.APPLE_NATIVE_SIGN_IN,
  });
}

/**
 * Cloud must never trust the self-host scheme: the app adopts a callback cookie on a custom
 * server only from that scheme, so a cloud session cannot reach one.
 */
export const getAppCallbackOrigins = ({ selfHost }: { selfHost: boolean }): string[] =>
  selfHost ? [IOS_APP_ORIGIN, IOS_SELF_HOST_APP_ORIGIN] : [IOS_APP_ORIGIN];

const readNonceClaim = ({ token }: { token: unknown }): unknown => {
  if (typeof token !== 'string') return undefined;
  try {
    return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')).nonce;
  } catch {
    return undefined;
  }
};

/**
 * Replay guard: a self-hosted server accepts only a nonce bound to its own authority, so an Apple
 * ID token collected by one server fails on every other. better-auth itself accepts a missing
 * nonce and the hash passed as the nonce. The claim is read before better-auth verifies the signature.
 */
export function checkAppleNonce({
  idToken,
  selfHost,
  authority,
}: {
  idToken: unknown;
  selfHost: boolean;
  authority: string;
}): AppleNonceError | null {
  const { token, nonce } = (typeof idToken === 'object' && idToken !== null ? idToken : {}) as {
    token?: unknown;
    nonce?: unknown;
  };

  if (typeof nonce !== 'string' || nonce === '') return APPLE_NONCE_ERROR.invalid;
  if (createHash('sha256').update(nonce).digest('hex') !== readNonceClaim({ token })) return APPLE_NONCE_ERROR.invalid;

  if (!selfHost) return HEX_64.test(nonce) ? null : APPLE_NONCE_ERROR.invalid;

  const prefix = `${authority}|`;
  return authority !== '' && nonce.startsWith(prefix) && HEX_64.test(nonce.slice(prefix.length))
    ? null
    : APPLE_NONCE_ERROR.serverMismatch;
}

/**
 * Sets `server` on a redirect into the app, replacing any value from the caller's `callbackURL`.
 * Null for http(s) and untrusted schemes: MCP client redirects must stay untouched.
 */
export function stampServerOnAppRedirect({
  location,
  authority,
  isTrustedOrigin,
}: {
  location: string;
  authority: string;
  isTrustedOrigin: (url: string) => boolean;
}): string | null {
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    return null;
  }
  if (url.protocol === 'http:' || url.protocol === 'https:' || !isTrustedOrigin(location)) return null;
  url.searchParams.set('server', authority);
  return url.toString();
}
