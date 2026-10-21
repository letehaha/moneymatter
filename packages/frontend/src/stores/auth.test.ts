import { api } from '@/api/_api';
import { getStoredEndpoint, setStoredEndpoint } from '@/common/utils/web-push-device';
import { AuthError } from '@/js/errors';
import { signOut } from '@/lib/auth-client';
import { useAuthStore } from '@/stores';
import { API_ERROR_CODES } from '@bt/shared/types';
import { createTestingPinia } from '@pinia/testing';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

vi.mock('@/lib/auth-client', () => ({
  authClient: {},
  getSession: vi.fn(),
  signIn: {},
  signUp: {},
  signOut: vi.fn(),
}));
// The real router would lazy-load the sign-in layout after the 401 handler's redirect.
vi.mock('@/routes', async () => ({
  ROUTES_NAMES: (await import('@/routes/constants')).ROUTES_NAMES,
  router: { push: vi.fn() },
}));
vi.mock('@/lib/query-persister', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/query-persister')>()),
  resetQueryCaches: vi.fn().mockResolvedValue(true),
  collectPersistedQueryGarbage: vi.fn(),
}));
vi.mock('@/lib/posthog', () => ({
  identifyUser: vi.fn(),
  resetUser: vi.fn(),
  startSessionRecording: vi.fn(),
  trackAnalyticsEvent: vi.fn(),
}));
vi.mock('@/lib/sentry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sentry')>()),
  captureException: vi.fn(),
  clearSentryUser: vi.fn(),
  setSentryUser: vi.fn(),
}));

const USER_ID = 7;
const ENDPOINT = 'https://web.push.apple.com/endpoint-one';

const jsonResponse = ({ status, body }: { status: number; body: unknown }) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('auth store logout and web push', () => {
  const unsubscribe = vi.fn().mockResolvedValue(true);
  const getSubscription = vi.fn();
  const fetchMock = vi.fn();
  const callOrder: string[] = [];

  const setupStore = () => {
    const pinia = createTestingPinia({
      createSpy: vi.fn,
      stubActions: false,
      initialState: { user: { user: { id: USER_ID, role: 'common' } } },
    });
    let store!: ReturnType<typeof useAuthStore>;

    mount(
      defineComponent({
        setup() {
          store = useAuthStore();
          return () => null;
        },
      }),
      { global: { plugins: [pinia, [VueQueryPlugin, { queryClient: new QueryClient() }]] } },
    );

    return store;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    callOrder.length = 0;
    localStorage.clear();
    setStoredEndpoint({ userId: USER_ID, endpoint: ENDPOINT });

    getSubscription.mockResolvedValue({ endpoint: ENDPOINT, unsubscribe });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: vi.fn().mockResolvedValue({ pushManager: { getSubscription } }) },
    });

    fetchMock.mockImplementation(async (url: string) => {
      callOrder.push(`fetch:${url}`);
      return jsonResponse({ status: 200, body: { status: 'success', response: {} } });
    });
    vi.stubGlobal('fetch', fetchMock);

    vi.mocked(signOut).mockImplementation((async () => {
      callOrder.push('signOut');
    }) as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  const unsubscribeCalls = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/push/subscriptions/unsubscribe'));

  describe('logout({ disablePush: true })', () => {
    it('removes the server row with a plain fetch, unsubscribes the browser and clears the stored endpoint, all before signOut', async () => {
      const store = setupStore();

      await store.logout({ disablePush: true });

      expect(unsubscribeCalls()).toHaveLength(1);
      expect(unsubscribeCalls()[0]![1]).toMatchObject({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ endpoint: ENDPOINT }),
      });
      expect(unsubscribe).toHaveBeenCalledOnce();
      expect(getStoredEndpoint({ userId: USER_ID })).toBeNull();
      expect(callOrder.at(-1)).toBe('signOut');
      expect(callOrder.filter((entry) => entry === 'signOut')).toHaveLength(1);
      expect(callOrder.some((entry) => entry.includes('/push/subscriptions/unsubscribe'))).toBe(true);
    });

    it('still signs out, once, when /unsubscribe answers 401', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        callOrder.push(`fetch:${url}`);
        return jsonResponse({
          status: 401,
          body: { status: 'error', response: { code: API_ERROR_CODES.unauthorized, message: 'Unauthorized' } },
        });
      });
      const store = setupStore();

      await store.logout({ disablePush: true });

      expect(signOut).toHaveBeenCalledOnce();
      expect(unsubscribeCalls()).toHaveLength(1);
      expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('still signs out when /unsubscribe cannot be reached', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      const store = setupStore();

      await store.logout({ disablePush: true });

      expect(signOut).toHaveBeenCalledOnce();
      expect(unsubscribe).toHaveBeenCalledOnce();
      expect(getStoredEndpoint({ userId: USER_ID })).toBeNull();
    });
  });

  describe('logout() without the flag', () => {
    it('leaves the browser subscription, the server row and the stored endpoint alone', async () => {
      const store = setupStore();

      await store.logout();

      expect(signOut).toHaveBeenCalledOnce();
      expect(getSubscription).not.toHaveBeenCalled();
      expect(unsubscribe).not.toHaveBeenCalled();
      expect(unsubscribeCalls()).toHaveLength(0);
      expect(getStoredEndpoint({ userId: USER_ID })).toBe(ENDPOINT);
    });

    it('is what the API client runs on an unauthorized response: an expired session keeps the subscription', async () => {
      setupStore();
      fetchMock.mockImplementation(async (url: string) => {
        callOrder.push(`fetch:${url}`);
        return jsonResponse({
          status: 401,
          body: { status: 'error', response: { code: API_ERROR_CODES.unauthorized, message: 'Unauthorized' } },
        });
      });

      await expect(api.get('/accounts')).rejects.toBeInstanceOf(AuthError);
      await vi.waitFor(() => expect(signOut).toHaveBeenCalledOnce());

      expect(getSubscription).not.toHaveBeenCalled();
      expect(unsubscribe).not.toHaveBeenCalled();
      expect(unsubscribeCalls()).toHaveLength(0);
      expect(getStoredEndpoint({ userId: USER_ID })).toBe(ENDPOINT);
    });
  });
});
