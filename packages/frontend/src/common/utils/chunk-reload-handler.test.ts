import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Router } from 'vue-router';

vi.mock('@/lib/sentry', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

const RELOAD_COUNTER_KEY = 'app:chunk-reload-attempts';
const RELOAD_TIMESTAMP_KEY = 'app:chunk-reload-timestamp';
const NAVIGATE_DEFER_MS = 50;

describe('chunk-reload-handler', () => {
  let handler: typeof import('./chunk-reload-handler');
  let captureExceptionMock: Mock;
  let addBreadcrumbMock: Mock;
  let reloadMock: ReturnType<typeof vi.fn>;
  let assignMock: ReturnType<typeof vi.fn>;
  let originalLocation: Location;

  beforeEach(async () => {
    // The module keeps per-incident state (pending navigation timer), so each
    // test gets a fresh module instance.
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    window.sessionStorage.clear();

    const sentry = await import('@/lib/sentry');
    captureExceptionMock = vi.mocked(sentry.captureException);
    addBreadcrumbMock = vi.mocked(sentry.addBreadcrumb);
    captureExceptionMock.mockClear();
    addBreadcrumbMock.mockClear();

    originalLocation = window.location;
    reloadMock = vi.fn();
    assignMock = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: reloadMock, assign: assignMock },
    });

    handler = await import('./chunk-reload-handler');
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    vi.useRealTimers();
  });

  const staleError = () => new TypeError('Failed to fetch dynamically imported module');

  describe('readCounter', () => {
    it('returns 0 when no key has been set', () => {
      expect(handler.readCounter()).toBe(0);
    });

    it('returns the stored value within the reset window', () => {
      window.sessionStorage.setItem(RELOAD_COUNTER_KEY, '1');
      window.sessionStorage.setItem(RELOAD_TIMESTAMP_KEY, String(Date.now()));
      expect(handler.readCounter()).toBe(1);
    });

    it('resets to 0 after the reset window has elapsed', () => {
      window.sessionStorage.setItem(RELOAD_COUNTER_KEY, '2');
      window.sessionStorage.setItem(RELOAD_TIMESTAMP_KEY, String(Date.now() - 61_000));
      expect(handler.readCounter()).toBe(0);
    });
  });

  describe('isStaleChunkError', () => {
    it.each([
      'Failed to fetch dynamically imported module https://x/assets/a.js',
      'Importing a module script failed.',
      'error loading dynamically imported module',
      'Unable to preload CSS for /assets/a.css',
      'Couldn\'t resolve component "default" at "/accounts"',
    ])('matches "%s"', (message) => {
      expect(handler.isStaleChunkError(new Error(message))).toBe(true);
    });

    it('rejects unrelated errors and non-errors', () => {
      expect(handler.isStaleChunkError(new Error('Cannot read properties of undefined'))).toBe(false);
      expect(handler.isStaleChunkError('some string')).toBe(false);
    });
  });

  describe('scheduleRecovery', () => {
    it('schedules a reload of the current url when no target is known', () => {
      expect(handler.scheduleRecovery({ error: staleError() })).toBe(true);

      expect(reloadMock).not.toHaveBeenCalled();
      vi.advanceTimersByTime(NAVIGATE_DEFER_MS);
      expect(reloadMock).toHaveBeenCalledOnce();
      expect(assignMock).not.toHaveBeenCalled();
    });

    it('navigates to the redirect target when one is provided', () => {
      expect(handler.scheduleRecovery({ error: staleError(), redirectTo: '/accounts' })).toBe(true);

      vi.advanceTimersByTime(NAVIGATE_DEFER_MS);
      expect(assignMock).toHaveBeenCalledWith('/accounts');
      expect(reloadMock).not.toHaveBeenCalled();
    });

    it('dedupes signals of the same incident and lets a later signal upgrade the target', () => {
      // vite:preloadError arrives first without a target...
      expect(handler.scheduleRecovery({ error: staleError() })).toBe(true);
      // ...router.onError arrives a tick later with the intended route.
      expect(handler.scheduleRecovery({ error: staleError(), redirectTo: '/accounts' })).toBe(true);

      vi.advanceTimersByTime(NAVIGATE_DEFER_MS);
      expect(assignMock).toHaveBeenCalledWith('/accounts');
      expect(reloadMock).not.toHaveBeenCalled();
      // Counter bumped once for the combined incident.
      expect(window.sessionStorage.getItem(RELOAD_COUNTER_KEY)).toBe('1');
    });

    it('reports a wrapped error and does not navigate once the cap is exhausted', () => {
      window.sessionStorage.setItem(RELOAD_COUNTER_KEY, '2');
      window.sessionStorage.setItem(RELOAD_TIMESTAMP_KEY, String(Date.now()));

      const original = staleError();
      expect(handler.scheduleRecovery({ error: original })).toBe(false);

      vi.advanceTimersByTime(NAVIGATE_DEFER_MS);
      expect(reloadMock).not.toHaveBeenCalled();
      expect(assignMock).not.toHaveBeenCalled();
      expect(captureExceptionMock).toHaveBeenCalledOnce();
      const { error, context } = captureExceptionMock.mock.calls[0]![0]!;
      // The wrapped message must NOT contain the original text — Sentry's
      // ignoreErrors patterns for chunk failures would swallow the report.
      expect(error.message).toBe('chunk-reload: retry cap exhausted, asset still unavailable after reloads');
      expect(context).toEqual({
        reason: 'chunk-reload-cap-exhausted',
        attempts: 2,
        originalMessage: original.message,
      });
    });

    it('allows a new recovery after the counter reset window', () => {
      window.sessionStorage.setItem(RELOAD_COUNTER_KEY, '2');
      window.sessionStorage.setItem(RELOAD_TIMESTAMP_KEY, String(Date.now() - 61_000));

      expect(handler.scheduleRecovery({ error: staleError() })).toBe(true);
      vi.advanceTimersByTime(NAVIGATE_DEFER_MS);
      expect(reloadMock).toHaveBeenCalledOnce();
    });
  });

  describe('installChunkReloadHandler', () => {
    const makeRouterStub = () => {
      const onError = vi.fn();
      return { router: { onError } as unknown as Router, onError };
    };

    const install = () => {
      const spy = vi.spyOn(window, 'addEventListener');
      const { router, onError } = makeRouterStub();
      handler.installChunkReloadHandler({ router });
      const call = spy.mock.calls.find(([event]) => event === 'vite:preloadError');
      spy.mockRestore();
      if (!call) throw new Error('vite:preloadError listener was not registered');
      const routerErrorHandler = onError.mock.calls[0]?.[0];
      if (!routerErrorHandler) throw new Error('router.onError handler was not registered');
      return { preloadHandler: call[1] as EventListener, routerErrorHandler };
    };

    const makeEvent = (error: Error) => {
      const event = new Event('vite:preloadError', { cancelable: true });
      Object.defineProperty(event, 'payload', { value: error });
      return event;
    };

    it('schedules recovery and calls preventDefault on a preload error', () => {
      const { preloadHandler } = install();
      const event = makeEvent(staleError());

      preloadHandler(event);

      expect(event.defaultPrevented).toBe(true);
      expect(addBreadcrumbMock).toHaveBeenCalledWith(expect.objectContaining({ category: 'chunk-reload' }));
      vi.advanceTimersByTime(NAVIGATE_DEFER_MS);
      expect(reloadMock).toHaveBeenCalledOnce();
    });

    it('does NOT call preventDefault when the recovery cap is exhausted', () => {
      window.sessionStorage.setItem(RELOAD_COUNTER_KEY, '2');
      window.sessionStorage.setItem(RELOAD_TIMESTAMP_KEY, String(Date.now()));
      const { preloadHandler } = install();

      const event = makeEvent(staleError());
      preloadHandler(event);

      expect(event.defaultPrevented).toBe(false);
      expect(captureExceptionMock).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(NAVIGATE_DEFER_MS);
      expect(reloadMock).not.toHaveBeenCalled();
    });

    it('reports a cap-exhausted incident to Sentry only once across all its signals', () => {
      window.sessionStorage.setItem(RELOAD_COUNTER_KEY, '2');
      window.sessionStorage.setItem(RELOAD_TIMESTAMP_KEY, String(Date.now()));
      const { preloadHandler, routerErrorHandler } = install();

      const first = makeEvent(staleError());
      preloadHandler(first);
      routerErrorHandler(new Error('Couldn\'t resolve component "default" at "/accounts"'), {
        fullPath: '/accounts',
      });
      const second = makeEvent(staleError());
      preloadHandler(second);

      expect(captureExceptionMock).toHaveBeenCalledOnce();
      expect(first.defaultPrevented).toBe(false);
      expect(second.defaultPrevented).toBe(false);
      vi.advanceTimersByTime(NAVIGATE_DEFER_MS);
      expect(reloadMock).not.toHaveBeenCalled();
      expect(assignMock).not.toHaveBeenCalled();
    });

    it('recovers to the intended route when preloadError and router error describe one incident', () => {
      const { preloadHandler, routerErrorHandler } = install();

      preloadHandler(makeEvent(staleError()));
      routerErrorHandler(new Error('Couldn\'t resolve component "default" at "/accounts"'), {
        fullPath: '/accounts',
      });

      vi.advanceTimersByTime(NAVIGATE_DEFER_MS);
      expect(assignMock).toHaveBeenCalledWith('/accounts');
      expect(reloadMock).not.toHaveBeenCalled();
      expect(window.sessionStorage.getItem(RELOAD_COUNTER_KEY)).toBe('1');
    });

    it('ignores router errors that are not stale-chunk failures', () => {
      const { routerErrorHandler } = install();

      routerErrorHandler(new Error('Navigation cancelled'), { fullPath: '/accounts' });

      vi.advanceTimersByTime(NAVIGATE_DEFER_MS);
      expect(assignMock).not.toHaveBeenCalled();
      expect(reloadMock).not.toHaveBeenCalled();
      expect(addBreadcrumbMock).not.toHaveBeenCalled();
    });
  });
});
