import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAuthErrorKey, getAuthErrorMessage } from './auth-error-message';
import { NetworkError } from './network.error';
import { UnexpectedError } from './unexpected.error';

const { ensureChunkLoaded } = vi.hoisted(() => ({ ensureChunkLoaded: vi.fn(() => Promise.resolve()) }));

vi.mock('@/i18n', () => ({
  ensureChunkLoaded,
  i18n: {
    global: {
      t: (key: string, params: Record<string, unknown> = {}) =>
        Object.keys(params).length ? `${key}:${JSON.stringify(params)}` : key,
    },
  },
}));

const FALLBACK = 'auth.login.errors.genericErrorRetry';

describe('getAuthErrorKey', () => {
  it.each(['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.'])(
    'maps the "%s" fetch TypeError to the network key',
    (message) => {
      expect(getAuthErrorKey({ error: new TypeError(message), fallbackKey: FALLBACK })).toBe(
        'errors.api.failedToFetch',
      );
    },
  );

  it('maps the API client NetworkError to the network key', () => {
    expect(getAuthErrorKey({ error: new NetworkError('offline'), fallbackKey: FALLBACK })).toBe(
      'errors.api.failedToFetch',
    );
  });

  it('maps status 0 to the network key', () => {
    expect(getAuthErrorKey({ error: { status: 0, message: '' }, fallbackKey: FALLBACK })).toBe(
      'errors.api.failedToFetch',
    );
  });

  it('maps 429 to the rate-limit key even though better-auth sends no code', () => {
    const error = new UnexpectedError('Too many requests. Please try again later.', { status: 429 });
    expect(getAuthErrorKey({ error, fallbackKey: FALLBACK })).toBe('errors.api.tooManyRequests');
  });

  it('reads the code from an UnexpectedError carrying result.error', () => {
    const error = new UnexpectedError('Invalid email or password', {
      code: 'INVALID_EMAIL_OR_PASSWORD',
      status: 401,
    });
    expect(
      getAuthErrorKey({
        error,
        codeKeys: { INVALID_EMAIL_OR_PASSWORD: 'auth.login.errors.incorrectEmailOrPassword' },
        fallbackKey: FALLBACK,
      }),
    ).toBe('auth.login.errors.incorrectEmailOrPassword');
  });

  it('reads the code from a raw better-auth result.error', () => {
    expect(
      getAuthErrorKey({ error: { code: 'FAILED_TO_UNLINK_LAST_ACCOUNT', status: 400 }, fallbackKey: FALLBACK }),
    ).toBe('errors.auth.cannotUnlinkLastAccount');
  });

  it('reads the code from an app-owned auth route envelope', () => {
    expect(
      getAuthErrorKey({
        error: { status: 400, response: { code: 'PASSWORD_ALREADY_SET', message: 'User already has a password set' } },
        codeKeys: { PASSWORD_ALREADY_SET: 'settings.security.passwordSection.errors.passwordAlreadySet' },
        fallbackKey: FALLBACK,
      }),
    ).toBe('settings.security.passwordSection.errors.passwordAlreadySet');
  });

  it('prefers caller code keys over the shared ones', () => {
    expect(
      getAuthErrorKey({
        error: { code: 'PASSWORD_TOO_SHORT', status: 400 },
        codeKeys: { PASSWORD_TOO_SHORT: 'auth.signup.errors.passwordTooShort' },
        fallbackKey: FALLBACK,
      }),
    ).toBe('auth.signup.errors.passwordTooShort');
  });

  it.each([
    ['unknown code', { code: 'SOMETHING_NEW', status: 400, message: 'Something new' }],
    ['plain Error', new Error('Login failed')],
    ['non-network TypeError', new TypeError('x is not a function')],
    ['undefined', undefined],
  ])('falls back for %s', (_label, error) => {
    expect(getAuthErrorKey({ error, fallbackKey: FALLBACK })).toBe(FALLBACK);
  });
});

describe('getAuthErrorMessage', () => {
  beforeEach(() => ensureChunkLoaded.mockClear());

  it('loads the errors chunk before translating an errors.* key', async () => {
    const message = await getAuthErrorMessage({ error: new TypeError('Failed to fetch'), fallbackKey: FALLBACK });
    expect(ensureChunkLoaded).toHaveBeenCalledWith('errors');
    expect(message).toBe('errors.api.failedToFetch');
  });

  it('skips the chunk load for page keys and passes params through', async () => {
    const message = await getAuthErrorMessage({
      error: undefined,
      fallbackKey: 'auth.login.errors.oauthFailed',
      params: { provider: 'Google' },
    });
    expect(ensureChunkLoaded).not.toHaveBeenCalled();
    expect(message).toBe('auth.login.errors.oauthFailed:{"provider":"Google"}');
  });
});
