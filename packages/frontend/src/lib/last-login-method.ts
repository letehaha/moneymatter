import { OAUTH_PROVIDERS_LIST } from '@bt/shared/types';

const LOGIN_METHODS = ['email', 'passkey', ...OAUTH_PROVIDERS_LIST] as const;

type LoginMethod = (typeof LOGIN_METHODS)[number];

const LAST_LOGIN_METHOD_KEY = 'last-login-method';
// OAuth only succeeds after the provider redirect, so the method waits here until the callback confirms the session.
const PENDING_LOGIN_METHOD_KEY = 'pending-login-method';

const parseLoginMethod = (value: string | null): LoginMethod | null =>
  LOGIN_METHODS.find((method) => method === value) ?? null;

// Storage throws when blocked (private browsing) or full; a cosmetic hint must never break sign-in.
const safely = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export const getLastLoginMethod = (): LoginMethod | null =>
  safely(() => parseLoginMethod(localStorage.getItem(LAST_LOGIN_METHOD_KEY)), null);

export const setLastLoginMethod = ({ method }: { method: LoginMethod }): void =>
  safely(() => localStorage.setItem(LAST_LOGIN_METHOD_KEY, method), undefined);

export const setPendingLoginMethod = ({ method }: { method: LoginMethod }): void =>
  safely(() => sessionStorage.setItem(PENDING_LOGIN_METHOD_KEY, method), undefined);

export const consumePendingLoginMethod = (): LoginMethod | null =>
  safely(() => {
    const method = parseLoginMethod(sessionStorage.getItem(PENDING_LOGIN_METHOD_KEY));
    sessionStorage.removeItem(PENDING_LOGIN_METHOD_KEY);
    return method;
  }, null);
