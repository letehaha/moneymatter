import { loadUserData } from '@/api';
import { ApiErrorResponseError } from '@/js/errors';
import { getSession, signOut } from '@/lib/auth-client';
import { resetUser } from '@/lib/posthog';
import { resetQueryCaches } from '@/lib/query-persister';
import { captureException } from '@/lib/sentry';
import { API_ERROR_CODES } from '@bt/shared/types';
import { USER } from '@tests/mocks';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from './auth';
import { resetAllDefinedStores } from './setup';
import { useUserStore } from './user';

vi.mock('./setup', () => ({ resetAllDefinedStores: vi.fn() }));
vi.mock('@/routes', () => ({
  ROUTES_NAMES: { signIn: 'auth.sign-in' },
  router: { resolve: () => ({ href: '/sign-in' }) },
}));
vi.mock('@/api', () => ({ loadUserData: vi.fn(), startFeatureTrial: vi.fn() }));
vi.mock('@/lib/auth-client', () => ({
  authClient: {},
  getSession: vi.fn(),
  signIn: { email: vi.fn().mockResolvedValue({}) },
  signOut: vi.fn(),
  signUp: {},
}));
vi.mock('@/lib/query-persister', () => ({
  resetQueryCaches: vi.fn().mockResolvedValue(true),
  collectPersistedQueryGarbage: vi.fn(),
}));
vi.mock('@/lib/posthog', () => ({
  identifyUser: vi.fn(),
  resetUser: vi.fn(),
  startSessionRecording: vi.fn(),
  trackAnalyticsEvent: vi.fn(),
}));
vi.mock('@/lib/sentry', () => ({ captureException: vi.fn(), clearSentryUser: vi.fn(), setSentryUser: vi.fn() }));
vi.mock('@/components/notification-center', () => ({ dismissPersistentNotifications: vi.fn() }));
vi.mock('@tanstack/vue-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/stores', async () => {
  const { useUserStore: realUserStore } = await import('./user');
  return {
    useUserStore: realUserStore,
    useCategoriesStore: () => ({ loadCategories: vi.fn() }),
    useCurrenciesStore: () => ({ loadBaseCurrency: vi.fn() }),
  };
});

describe('useAuthStore login', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.mocked(loadUserData).mockResolvedValue(USER);
  });

  // User-gated queries start fetching once the user is published; a wipe after that orphans them.
  it('wipes the previous user cache before publishing the new user', async () => {
    localStorage.setItem('persisted-queries-user-id', String(USER.id + 1));
    const userStore = useUserStore();
    let userAtWipe: unknown = 'not-called';
    vi.mocked(resetQueryCaches).mockImplementation(async () => {
      userAtWipe = userStore.user;
      return true;
    });

    await useAuthStore().login({ email: 'a@b.c', password: 'x' });

    expect(userAtWipe).toBeNull();
    expect(userStore.user).toEqual(USER);
  });
});

describe('useAuthStore logout', () => {
  const assign = vi.fn();

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.stubGlobal('location', { ...window.location, origin: 'http://localhost:8100', assign });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks for the provider logout URL without letting the client redirect', async () => {
    vi.mocked(signOut).mockResolvedValue({ data: { success: true }, error: null });

    await useAuthStore().logout();

    expect(signOut).toHaveBeenCalledWith({
      disableRedirect: true,
      callbackURL: 'http://localhost:8100/sign-in',
    });
  });

  it('stays on the app when the server returns no provider logout URL', async () => {
    vi.mocked(signOut).mockResolvedValue({ data: { success: true }, error: null });

    await useAuthStore().logout();

    expect(resetQueryCaches).toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('wipes local state before navigating to the provider logout URL', async () => {
    const url = 'https://id.example.com/api/oidc/end-session?client_id=x';
    vi.mocked(signOut).mockResolvedValue({ data: { success: true, url, redirect: false }, error: null });

    await useAuthStore().logout();

    expect(assign).toHaveBeenCalledWith(url);
    const assignedAt = assign.mock.invocationCallOrder[0]!;
    for (const cleanup of [resetUser, resetQueryCaches, resetAllDefinedStores]) {
      expect(vi.mocked(cleanup).mock.invocationCallOrder[0]).toBeLessThan(assignedAt);
    }
  });

  it('still clears local state when sign-out throws', async () => {
    vi.mocked(signOut).mockRejectedValue(new Error('network'));

    await useAuthStore().logout();

    expect(resetQueryCaches).toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('useAuthStore validateSession', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue({ data: { session: {} } } as never);
  });

  it('signs out without reporting a server-side failure', async () => {
    vi.mocked(loadUserData).mockRejectedValue(
      new ApiErrorResponseError('500', { code: API_ERROR_CODES.unexpected, message: '500' }),
    );
    const store = useAuthStore();

    expect(await store.validateSession()).toBe(false);
    expect(store.isSessionChecked).toBe(true);
    expect(captureException).not.toHaveBeenCalled();
  });

  it('reports a client-side API error', async () => {
    vi.mocked(loadUserData).mockRejectedValue(
      new ApiErrorResponseError('400', { code: API_ERROR_CODES.validationError, message: '400' }),
    );

    expect(await useAuthStore().validateSession()).toBe(false);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ context: { scope: 'auth:validate-session' } }),
    );
  });
});
