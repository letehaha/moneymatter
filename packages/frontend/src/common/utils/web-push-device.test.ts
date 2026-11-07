import { unsubscribeEndpointRaw } from '@/api/web-push';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearStoredEndpoint,
  getEndpointHash,
  getStoredEndpoint,
  removeThisDevice,
  setStoredEndpoint,
} from './web-push-device';

vi.mock('@/api/web-push', () => ({ unsubscribeEndpointRaw: vi.fn().mockResolvedValue(true) }));

const stubRegistration = ({ subscription }: { subscription: unknown }) => {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: vi
        .fn()
        .mockResolvedValue({ pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription) } }),
    },
  });
};

describe('web-push-device', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(unsubscribeEndpointRaw).mockClear();
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
    vi.restoreAllMocks();
  });

  describe('stored endpoint', () => {
    it('is stored per user', () => {
      setStoredEndpoint({ userId: 1, endpoint: 'https://push.example/a' });
      setStoredEndpoint({ userId: 2, endpoint: 'https://push.example/b' });

      expect(getStoredEndpoint({ userId: 1 })).toBe('https://push.example/a');
      expect(getStoredEndpoint({ userId: 2 })).toBe('https://push.example/b');

      clearStoredEndpoint({ userId: 1 });

      expect(getStoredEndpoint({ userId: 1 })).toBeNull();
      expect(getStoredEndpoint({ userId: 2 })).toBe('https://push.example/b');
    });

    it('survives storage that throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('blocked');
      });

      expect(getStoredEndpoint({ userId: 1 })).toBeNull();
      expect(() => setStoredEndpoint({ userId: 1, endpoint: 'x' })).not.toThrow();
      expect(() => clearStoredEndpoint({ userId: 1 })).not.toThrow();
    });
  });

  describe('getEndpointHash', () => {
    // Fixture computed with the backend's definition: SHA-256 hex of the endpoint, first 16 characters.
    it('equals the backend endpointHash for the same input', async () => {
      expect(await getEndpointHash({ endpoint: 'https://web.push.apple.com/QGxyz-abc_DEF' })).toBe('30516879bc5c13c1');
    });
  });

  describe('removeThisDevice', () => {
    it('removes the server row with the raw call, unsubscribes the browser and clears the stored endpoint', async () => {
      const unsubscribe = vi.fn().mockResolvedValue(true);
      stubRegistration({ subscription: { endpoint: 'https://push.example/a', unsubscribe } });
      setStoredEndpoint({ userId: 1, endpoint: 'https://push.example/a' });

      await removeThisDevice({ userId: 1 });

      expect(unsubscribeEndpointRaw).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: 'https://push.example/a' }),
      );
      expect(unsubscribe).toHaveBeenCalledOnce();
      expect(getStoredEndpoint({ userId: 1 })).toBeNull();
    });

    it('still unsubscribes the browser and clears storage when the server call fails', async () => {
      const unsubscribe = vi.fn().mockResolvedValue(true);
      stubRegistration({ subscription: { endpoint: 'https://push.example/a', unsubscribe } });
      vi.mocked(unsubscribeEndpointRaw).mockRejectedValueOnce(new Error('offline'));
      setStoredEndpoint({ userId: 1, endpoint: 'https://push.example/a' });

      await expect(removeThisDevice({ userId: 1 })).resolves.toBeUndefined();

      expect(unsubscribe).toHaveBeenCalledOnce();
      expect(getStoredEndpoint({ userId: 1 })).toBeNull();
    });

    it('does not wait on a browser unsubscribe that never settles', async () => {
      vi.useFakeTimers();
      try {
        const unsubscribe = vi.fn(() => new Promise<boolean>(() => {}));
        stubRegistration({ subscription: { endpoint: 'https://push.example/a', unsubscribe } });
        setStoredEndpoint({ userId: 1, endpoint: 'https://push.example/a' });
        let settled = false;

        const removal = removeThisDevice({ userId: 1 }).then(() => {
          settled = true;
        });
        await vi.advanceTimersByTimeAsync(4000);
        expect(settled).toBe(false);

        await vi.advanceTimersByTimeAsync(1500);
        await removal;

        expect(unsubscribe).toHaveBeenCalledOnce();
        expect(getStoredEndpoint({ userId: 1 })).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('does nothing but clear storage when the browser has no subscription', async () => {
      stubRegistration({ subscription: null });
      setStoredEndpoint({ userId: 1, endpoint: 'https://push.example/a' });

      await removeThisDevice({ userId: 1 });

      expect(unsubscribeEndpointRaw).not.toHaveBeenCalled();
      expect(getStoredEndpoint({ userId: 1 })).toBeNull();
    });

    it('works in a browser without service workers', async () => {
      await expect(removeThisDevice({ userId: 1 })).resolves.toBeUndefined();
    });
  });
});
