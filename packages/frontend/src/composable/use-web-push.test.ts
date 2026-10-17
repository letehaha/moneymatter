import * as pushApi from '@/api/web-push';
import { arrayBufferToBase64Url } from '@/common/utils/base64url';
import { registerServiceWorker } from '@/common/utils/register-service-worker';
import { getEndpointHash, getStoredEndpoint, setStoredEndpoint } from '@/common/utils/web-push-device';
import { type PushSupport, getPushSupport } from '@/common/utils/web-push-support';
import { useSafariDetection } from '@/composable/detect-safari';
import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES } from '@bt/shared/types';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

import { resetWebPushState, useWebPush } from './use-web-push';

vi.mock('@/api/web-push', () => ({
  getPushConfig: vi.fn(),
  getPushDevices: vi.fn(),
  subscribePush: vi.fn(),
  unsubscribePush: vi.fn(),
  syncPushSubscription: vi.fn(),
  removePushDevice: vi.fn(),
  sendTestPush: vi.fn(),
}));
vi.mock('@/common/utils/web-push-support', () => ({ getPushSupport: vi.fn() }));
vi.mock('@/common/utils/register-service-worker', () => ({ registerServiceWorker: vi.fn() }));
vi.mock('@/composable/detect-safari', () => ({ useSafariDetection: vi.fn() }));
vi.mock('@/stores', () => ({ useUserStore: () => ({ user: { id: 1 } }) }));

const USER_ID = 1;
const E1 = 'https://web.push.apple.com/endpoint-one';
const E2 = 'https://web.push.apple.com/endpoint-two';

const vapidBytes = (seed: number) => Uint8Array.from({ length: 65 }, (_, index) => (index + seed) % 256);
const VAPID_PUBLIC_KEY = arrayBufferToBase64Url({ buffer: vapidBytes(0) });

const buildSubscription = ({ endpoint = E1, keySeed = 0 }: { endpoint?: string; keySeed?: number } = {}) => ({
  endpoint,
  options: { applicationServerKey: vapidBytes(keySeed).buffer },
  toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'p256dh-key', auth: 'auth-key' } }),
  unsubscribe: vi.fn().mockResolvedValue(true),
});

type FakeSubscription = ReturnType<typeof buildSubscription>;

const buildRegistration = ({ existing = null }: { existing?: FakeSubscription | null } = {}) => {
  let current = existing;
  const registration = {
    pushManager: {
      getSubscription: vi.fn(async () => current),
      subscribe: vi.fn(async () => {
        current = buildSubscription();
        return current;
      }),
    },
  };

  return registration;
};

type FakeRegistration = ReturnType<typeof buildRegistration>;

const stubServiceWorker = ({
  registration,
  hasRegistration,
}: {
  registration: FakeRegistration;
  hasRegistration: boolean;
}) => {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: vi.fn().mockResolvedValue(hasRegistration ? registration : undefined),
      ready: Promise.resolve(registration),
    },
  });
  vi.mocked(registerServiceWorker).mockResolvedValue(registration as unknown as ServiceWorkerRegistration);
};

describe('useWebPush', () => {
  let queryClient: QueryClient;
  let support: PushSupport;

  const mountWebPush = () => {
    let result!: ReturnType<typeof useWebPush>;

    mount(
      defineComponent({
        setup() {
          result = useWebPush();
          return () => null;
        },
      }),
      { global: { plugins: [[VueQueryPlugin, { queryClient }]] } },
    );

    return result;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetWebPushState();
    localStorage.clear();
    Reflect.deleteProperty(navigator, 'serviceWorker');
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    support = 'default';
    vi.mocked(getPushSupport).mockImplementation(() => support);
    vi.mocked(useSafariDetection).mockReturnValue({ isIOS: false, isPWA: false } as ReturnType<
      typeof useSafariDetection
    >);
    vi.mocked(pushApi.getPushConfig).mockResolvedValue({ enabled: true, vapidPublicKey: VAPID_PUBLIC_KEY });
    vi.mocked(pushApi.getPushDevices).mockResolvedValue([]);
    vi.mocked(pushApi.subscribePush).mockResolvedValue({} as never);
    vi.mocked(pushApi.unsubscribePush).mockResolvedValue(undefined);
    vi.mocked(pushApi.syncPushSubscription).mockResolvedValue({ known: true });
  });

  describe('enable', () => {
    it('calls pushManager.subscribe as its first await, then POSTs the subscription with the label and refreshes the list', async () => {
      const registration = buildRegistration();
      stubServiceWorker({ registration, hasRegistration: false });
      const webPush = mountWebPush();
      await webPush.prepare();
      await vi.waitFor(() => expect(webPush.state.value).toBe('off'));
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

      const pending = webPush.enable();

      // Nothing was awaited before subscribe: the permission prompt stays inside the user gesture.
      expect(registration.pushManager.subscribe).toHaveBeenCalledTimes(1);
      expect(registration.pushManager.subscribe).toHaveBeenCalledWith({
        userVisibleOnly: true,
        applicationServerKey: expect.any(Uint8Array),
      });
      expect(pushApi.subscribePush).not.toHaveBeenCalled();

      expect(await pending).toBe('enabled');
      expect(pushApi.subscribePush).toHaveBeenCalledWith(
        {
          endpoint: E1,
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
          expirationTime: null,
          deviceLabel: expect.any(String),
        },
        { silent: undefined },
      );
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['push-devices'] });
      expect(getStoredEndpoint({ userId: USER_ID })).toBe(E1);
      expect(webPush.state.value).toBe('on');
    });

    it('adds the Home Screen suffix to the label of an iOS Home Screen app', async () => {
      vi.mocked(useSafariDetection).mockReturnValue({ isIOS: true, isPWA: true } as ReturnType<
        typeof useSafariDetection
      >);
      const registration = buildRegistration();
      stubServiceWorker({ registration, hasRegistration: false });
      const webPush = mountWebPush();
      await webPush.prepare();

      await webPush.enable();

      const payload = vi.mocked(pushApi.subscribePush).mock.calls[0]![0];
      expect(payload.deviceLabel).toMatch(/ \(Home Screen\)$/);
    });

    it('sets denied and POSTs nothing when the permission is denied', async () => {
      const registration = buildRegistration();
      stubServiceWorker({ registration, hasRegistration: false });
      const webPush = mountWebPush();
      await webPush.prepare();
      registration.pushManager.subscribe.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
      support = 'denied';

      expect(await webPush.enable()).toBe('denied');

      expect(pushApi.subscribePush).not.toHaveBeenCalled();
      expect(webPush.state.value).toBe('denied');
    });

    it('leaves the toggle off without a verdict when the prompt is dismissed', async () => {
      const registration = buildRegistration();
      stubServiceWorker({ registration, hasRegistration: false });
      const webPush = mountWebPush();
      await webPush.prepare();
      registration.pushManager.subscribe.mockRejectedValueOnce(new DOMException('dismissed', 'NotAllowedError'));

      expect(await webPush.enable()).toBe('dismissed');

      expect(pushApi.subscribePush).not.toHaveBeenCalled();
      expect(webPush.state.value).toBe('off');
    });

    it('removes a stale subscription after an InvalidStateError and asks for another tap', async () => {
      const stale = buildSubscription({ keySeed: 7 });
      const registration = buildRegistration({ existing: stale });
      stubServiceWorker({ registration, hasRegistration: false });
      const webPush = mountWebPush();
      // Skip the reconcile, which would remove the stale subscription before the click.
      registration.pushManager.subscribe.mockRejectedValueOnce(new DOMException('key', 'InvalidStateError'));
      await webPush.prepare();
      stale.unsubscribe.mockClear();
      registration.pushManager.getSubscription.mockResolvedValueOnce(stale);

      expect(await webPush.enable()).toBe('tap-again');

      expect(stale.unsubscribe).toHaveBeenCalledOnce();
      expect(webPush.needsTapAgain.value).toBe(true);
      expect(pushApi.subscribePush).not.toHaveBeenCalled();
    });

    it('rolls the browser subscription back when the server rejects it', async () => {
      const registration = buildRegistration();
      stubServiceWorker({ registration, hasRegistration: false });
      vi.mocked(pushApi.subscribePush).mockRejectedValue(new Error('422'));
      const webPush = mountWebPush();
      await webPush.prepare();

      expect(await webPush.enable()).toBe('failed');

      const subscription = await registration.pushManager.getSubscription();
      expect(subscription?.unsubscribe).toHaveBeenCalledOnce();
      expect(getStoredEndpoint({ userId: USER_ID })).toBeNull();
      expect(webPush.state.value).toBe('off');
    });
  });

  describe('disable', () => {
    it('unsubscribes in the browser, calls /unsubscribe and forgets the stored endpoint', async () => {
      const subscription = buildSubscription();
      const registration = buildRegistration({ existing: subscription });
      stubServiceWorker({ registration, hasRegistration: true });
      setStoredEndpoint({ userId: USER_ID, endpoint: E1 });
      const webPush = mountWebPush();
      await webPush.syncOnLoad();
      await vi.waitFor(() => expect(webPush.state.value).toBe('on'));

      await webPush.disable();

      expect(subscription.unsubscribe).toHaveBeenCalledOnce();
      expect(pushApi.unsubscribePush).toHaveBeenCalledWith({ endpoint: E1 }, { silent: undefined });
      expect(getStoredEndpoint({ userId: USER_ID })).toBeNull();
      expect(webPush.state.value).toBe('off');
    });
  });

  describe('key change', () => {
    it.each(['syncOnLoad', 'prepare'] as const)(
      '%s removes a subscription made under another key, without /sync, and leaves the toggle off',
      async (entryPoint) => {
        const stale = buildSubscription({ keySeed: 5 });
        const registration = buildRegistration({ existing: stale });
        stubServiceWorker({ registration, hasRegistration: true });
        setStoredEndpoint({ userId: USER_ID, endpoint: E1 });
        const webPush = mountWebPush();

        await webPush[entryPoint]();

        expect(stale.unsubscribe).toHaveBeenCalled();
        expect(pushApi.unsubscribePush).toHaveBeenCalledWith({ endpoint: E1 }, { silent: true });
        expect(pushApi.syncPushSubscription).not.toHaveBeenCalled();
        expect(getStoredEndpoint({ userId: USER_ID })).toBeNull();
        await vi.waitFor(() => expect(webPush.state.value).toBe('off'));
      },
    );

    it('keeps subscribe as the first await of a later enable', async () => {
      const stale = buildSubscription({ keySeed: 5 });
      const registration = buildRegistration({ existing: stale });
      stubServiceWorker({ registration, hasRegistration: true });
      const webPush = mountWebPush();
      await webPush.prepare();
      await vi.waitFor(() => expect(webPush.state.value).toBe('off'));
      registration.pushManager.getSubscription.mockClear();

      const pending = webPush.enable();

      expect(registration.pushManager.subscribe).toHaveBeenCalledTimes(1);
      expect(registration.pushManager.getSubscription).not.toHaveBeenCalled();
      await pending;
    });
  });

  describe('syncOnLoad', () => {
    it('calls /sync once per page load', async () => {
      const registration = buildRegistration({ existing: buildSubscription() });
      stubServiceWorker({ registration, hasRegistration: true });
      setStoredEndpoint({ userId: USER_ID, endpoint: E1 });
      const webPush = mountWebPush();

      await webPush.syncOnLoad();
      await webPush.syncOnLoad();
      await mountWebPush().syncOnLoad();

      expect(pushApi.syncPushSubscription).toHaveBeenCalledTimes(1);
      expect(pushApi.syncPushSubscription).toHaveBeenCalledWith({ endpoint: E1 });
      expect(webPush.state.value).toBe('on');
    });

    it('does nothing when the browser has no subscription', async () => {
      const registration = buildRegistration();
      stubServiceWorker({ registration, hasRegistration: true });
      const webPush = mountWebPush();

      await webPush.syncOnLoad();

      expect(pushApi.syncPushSubscription).not.toHaveBeenCalled();
      expect(pushApi.subscribePush).not.toHaveBeenCalled();
    });

    it('does not register a worker when none exists', async () => {
      stubServiceWorker({ registration: buildRegistration(), hasRegistration: false });
      const webPush = mountWebPush();

      await webPush.syncOnLoad();

      expect(registerServiceWorker).not.toHaveBeenCalled();
      expect(pushApi.syncPushSubscription).not.toHaveBeenCalled();
    });

    it('leaves the toggle off, without subscribing, when the server does not know the device', async () => {
      const subscription = buildSubscription();
      const registration = buildRegistration({ existing: subscription });
      stubServiceWorker({ registration, hasRegistration: true });
      setStoredEndpoint({ userId: USER_ID, endpoint: E1 });
      vi.mocked(pushApi.syncPushSubscription).mockResolvedValue({ known: false });
      const webPush = mountWebPush();

      await webPush.syncOnLoad();
      await vi.waitFor(() => expect(webPush.state.value).toBe('off'));

      expect(subscription.unsubscribe).toHaveBeenCalledOnce();
      expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
      expect(getStoredEndpoint({ userId: USER_ID })).toBeNull();
    });

    it('goes to /sync, never to Rotate, when nothing is stored, and stores the endpoint of a known device', async () => {
      const registration = buildRegistration({ existing: buildSubscription() });
      stubServiceWorker({ registration, hasRegistration: true });
      const webPush = mountWebPush();

      await webPush.syncOnLoad();

      expect(pushApi.syncPushSubscription).toHaveBeenCalledOnce();
      expect(pushApi.subscribePush).not.toHaveBeenCalled();
      expect(getStoredEndpoint({ userId: USER_ID })).toBe(E1);
    });

    it('goes to /sync when the stored endpoint equals the browser one', async () => {
      const registration = buildRegistration({ existing: buildSubscription() });
      stubServiceWorker({ registration, hasRegistration: true });
      setStoredEndpoint({ userId: USER_ID, endpoint: E1 });
      const webPush = mountWebPush();

      await webPush.syncOnLoad();

      expect(pushApi.syncPushSubscription).toHaveBeenCalledOnce();
      expect(pushApi.subscribePush).not.toHaveBeenCalled();
    });

    it('does nothing when the instance has push switched off', async () => {
      vi.mocked(pushApi.getPushConfig).mockResolvedValue({ enabled: false, vapidPublicKey: null });
      const registration = buildRegistration({ existing: buildSubscription() });
      stubServiceWorker({ registration, hasRegistration: true });
      const webPush = mountWebPush();

      await webPush.syncOnLoad();
      await webPush.prepare();

      expect(registerServiceWorker).not.toHaveBeenCalled();
      expect(pushApi.syncPushSubscription).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(webPush.state.value).toBe('server-disabled'));
    });
  });

  describe('rotation', () => {
    const arrange = () => {
      const subscription = buildSubscription({ endpoint: E2 });
      const registration = buildRegistration({ existing: subscription });
      stubServiceWorker({ registration, hasRegistration: true });
      setStoredEndpoint({ userId: USER_ID, endpoint: E1 });

      return { subscription, registration };
    };

    it('sends Rotate with the stored endpoint as oldEndpoint, stores the new one and keeps the toggle on', async () => {
      arrange();
      const webPush = mountWebPush();

      await webPush.syncOnLoad();

      expect(pushApi.subscribePush).toHaveBeenCalledWith(
        {
          endpoint: E2,
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
          expirationTime: null,
          deviceLabel: expect.any(String),
          oldEndpoint: E1,
        },
        { silent: true },
      );
      expect(pushApi.syncPushSubscription).not.toHaveBeenCalled();
      expect(getStoredEndpoint({ userId: USER_ID })).toBe(E2);
      await vi.waitFor(() => expect(webPush.state.value).toBe('on'));
    });

    it('reads the idempotent 200 after a worker rotation as known: keeps the subscription, and the next load goes to /sync', async () => {
      const { subscription } = arrange();
      // The server already holds E2 (the worker's own request ran first); Rotate answers 200.
      vi.mocked(pushApi.subscribePush).mockResolvedValue({ id: 'device-1' } as never);
      const webPush = mountWebPush();

      await webPush.syncOnLoad();

      expect(subscription.unsubscribe).not.toHaveBeenCalled();
      expect(getStoredEndpoint({ userId: USER_ID })).toBe(E2);
      await vi.waitFor(() => expect(webPush.state.value).toBe('on'));

      // Next page load.
      vi.mocked(pushApi.subscribePush).mockClear();
      resetWebPushState();
      await mountWebPush().syncOnLoad();

      expect(pushApi.syncPushSubscription).toHaveBeenCalledWith({ endpoint: E2 });
      expect(pushApi.subscribePush).not.toHaveBeenCalled();
    });

    it('unsubscribes the browser, clears the stored endpoint and leaves the toggle off on a 404', async () => {
      const { subscription } = arrange();
      vi.mocked(pushApi.subscribePush).mockRejectedValue(
        new ApiErrorResponseError('not found', { code: API_ERROR_CODES.notFound } as never),
      );
      const webPush = mountWebPush();

      await webPush.syncOnLoad();

      expect(subscription.unsubscribe).toHaveBeenCalledOnce();
      expect(getStoredEndpoint({ userId: USER_ID })).toBeNull();
      expect(pushApi.syncPushSubscription).not.toHaveBeenCalled();
    });

    it('keeps everything on another failure, so a later load can retry', async () => {
      const { subscription } = arrange();
      vi.mocked(pushApi.subscribePush).mockRejectedValue(new Error('offline'));
      const webPush = mountWebPush();

      await webPush.syncOnLoad();

      expect(subscription.unsubscribe).not.toHaveBeenCalled();
      expect(getStoredEndpoint({ userId: USER_ID })).toBe(E1);
    });

    it('stores a worker-announced endpoint without any request', async () => {
      arrange();
      const webPush = mountWebPush();
      await webPush.syncOnLoad();
      vi.clearAllMocks();

      await webPush.handleEndpointChanged({ endpoint: 'https://web.push.apple.com/endpoint-three' });

      expect(getStoredEndpoint({ userId: USER_ID })).toBe('https://web.push.apple.com/endpoint-three');
      expect(pushApi.subscribePush).not.toHaveBeenCalled();
      expect(pushApi.syncPushSubscription).not.toHaveBeenCalled();
    });

    it('ignores a worker-announced endpoint from a browser this user never registered', async () => {
      const webPush = mountWebPush();

      await webPush.handleEndpointChanged({ endpoint: E2 });

      expect(getStoredEndpoint({ userId: USER_ID })).toBeNull();
    });
  });

  describe('isThisDevice', () => {
    it('matches a device by endpointHash', async () => {
      const registration = buildRegistration({ existing: buildSubscription() });
      stubServiceWorker({ registration, hasRegistration: true });
      const webPush = mountWebPush();
      expect(webPush.isThisDevice({ endpointHash: 'anything' })).toBe(false);

      await webPush.syncOnLoad();
      await flushPromises();

      expect(webPush.isThisDevice({ endpointHash: await getEndpointHash({ endpoint: E1 }) })).toBe(true);
      expect(webPush.isThisDevice({ endpointHash: await getEndpointHash({ endpoint: E2 }) })).toBe(false);
    });
  });

  describe('state', () => {
    it.each(['unsupported', 'needs-home-screen', 'denied'] as const)(
      'reports %s from the browser support',
      async (value) => {
        support = value;
        const webPush = mountWebPush();

        await vi.waitFor(() => expect(webPush.state.value).toBe(value));
      },
    );

    it('registers no worker when the browser cannot use push', async () => {
      support = 'unsupported';
      const webPush = mountWebPush();

      await webPush.prepare();

      expect(registerServiceWorker).not.toHaveBeenCalled();
    });
  });
});
