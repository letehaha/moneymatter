import { config } from '@/common/config';
import * as Sentry from '@sentry/vue';
import { makeFetchTransport } from '@sentry/vue';
import type { App } from 'vue';
import type { Router } from 'vue-router';

/**
 * Check if Sentry should be enabled.
 * Only enabled in production with valid DSN.
 */
function isSentryEnabled(): boolean {
  const isProduction = import.meta.env.PROD;
  const hasDsn = Boolean(config.sentryDsn);

  return isProduction && hasDsn;
}

/**
 * Custom transport that silently handles errors (e.g., when blocked by ad blockers).
 * Wraps the default fetch transport and catches any network failures.
 */
function makeSilentFetchTransport(options: Parameters<typeof makeFetchTransport>[0]) {
  const transport = makeFetchTransport(options);

  return {
    ...transport,
    send: async (envelope: Parameters<typeof transport.send>[0]) => {
      try {
        return await transport.send(envelope);
      } catch {
        // Silently ignore transport errors (likely blocked by ad blocker)
        return { statusCode: 0 };
      }
    },
  };
}

/**
 * Initialize Sentry error tracking.
 * Should be called before app.mount().
 */
export function initSentry({ app, router }: { app: App; router: Router }): void {
  if (!isSentryEnabled()) {
    return;
  }

  Sentry.init({
    app,
    dsn: config.sentryDsn,
    release: config.sentryRelease,
    // Use custom transport that silently handles blocked requests
    transport: makeSilentFetchTransport,
    integrations: [
      // Browser tracing for performance monitoring
      Sentry.browserTracingIntegration({
        router,
        ignoreResourceSpans: ['resource.script', 'resource.link', 'resource.css', 'resource.other'],
      }),
      // Replay for session recordings on errors
      Sentry.replayIntegration({
        // Mask all text for privacy
        maskAllText: true,
        // Block all media
        blockAllMedia: true,
      }),
    ],
    // Each sampled transaction fans out into a span per resource, fetch and web
    // vital, so the span bill scales far faster than this rate suggests.
    tracesSampleRate: 0.01,
    // Replays are capped at 50/month, so only sessions with errors are recorded.
    replaysSessionSampleRate: 0,
    // Capture 100% of sessions with errors
    replaysOnErrorSampleRate: 1.0,
    // Environment
    environment: import.meta.env.MODE,
    // Only accept errors whose stack frames come from the app's own bundle.
    // The bundle is always served from the page origin (no CDN), so this one
    // entry covers cloud and any self-hosted domain, while still filtering
    // browser-extension and injected third-party scripts.
    allowUrls: [window.location.origin],
    // Ignore common non-actionable errors
    ignoreErrors: [
      // Network errors
      'Network request failed',
      'Failed to fetch',
      'NetworkError',
      'Load failed',
      // Browser extensions
      /^chrome-extension:\/\//,
      /^moz-extension:\/\//,
      // Safari WebExtension runtime errors arrive as stackless rejections, so allowUrls cannot drop them.
      // Fixes MONEY-MATTER-CLIENT-18
      /Invalid call to runtime\.\w+\(\)/,
      // ResizeObserver (harmless)
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      // User aborted
      'AbortError',
      'The operation was aborted',
      // Expired/invalid session — app handles it (logout + redirect + toast),
      // the thrown AuthError is just a caller signal, not an actionable bug.
      // Fixes MONEY-MATTER-CLIENT-R
      'AuthError',
      // Stale-chunk-after-deploy: chunk-reload-handler recovers by navigating
      // to the fresh bundle, so these are noise; unrecoverable incidents
      // re-report as "chunk-reload: retry cap exhausted" which none of these
      // patterns can match.
      // Fixes MONEY-MATTER-CLIENT-Q + MONEY-MATTER-CLIENT-F
      /Failed to fetch dynamically imported module/,
      /Importing a module script failed/,
      /error loading dynamically imported module/,
      /Unable to preload CSS/,
      /Couldn't resolve component/,
      // Vue vDOM patch/unmount crashes triggered by third-party DOM mutation
      // (browser translation extensions, injected widgets) editing nodes Vue
      // owns. The stack is entirely Vue-internal with no app frame, so there is
      // nothing to fix in app code — only the environment differs.
      // Fixes MONEY-MATTER-CLIENT-X + MONEY-MATTER-CLIENT-11 + MONEY-MATTER-CLIENT-Z + MONEY-MATTER-CLIENT-Y + MONEY-MATTER-CLIENT-1X
      /Failed to execute 'insertBefore' on 'Node'/,
      /Cannot read properties of null \(reading '(parentNode|nextSibling)'\)/,
      /can't access property "(parentNode|nextSibling)", [\w$]+ is null/,
      /Cannot destructure property 'bum'/,
      // TanStack cancels in-flight queries on purpose when the boot watchdog resets
      // the cache; the rejection reaching a top-level await is not a bug.
      // Fixes MONEY-MATTER-CLIENT-1N
      'CancelledError',
      // A bare `reject()`/`reject(null)` carries no stack, so nothing can be acted on.
      // Fixes MONEY-MATTER-CLIENT-15
      /Non-Error promise rejection captured with value: (null|undefined)/,
      // Synthetic `new CustomEvent('unhandledrejection')` dispatched by injected scripts; the app never dispatches one.
      // Fixes MONEY-MATTER-CLIENT-1S
      /Event `CustomEvent` \(type=unhandledrejection\) captured as promise rejection/,
      // Stale i18n JSON chunk after a deploy — same class as the dynamic-import
      // patterns above; the page reload from chunk-reload-handler clears it.
      // Fixes MONEY-MATTER-CLIENT-1P + MONEY-MATTER-CLIENT-1Q + MONEY-MATTER-CLIENT-1F
      /resolved without message content/,
    ],
    // Before sending error, add extra context
    beforeSend(event, hint) {
      // Don't send errors in development
      if (import.meta.env.DEV) {
        console.error('[Sentry Debug]', hint.originalException || hint.syntheticException);
        return null;
      }
      return event;
    },
  });
}

/**
 * Set user context for error tracking.
 * Call this when user logs in.
 */
export function setSentryUser({ userId }: { userId: string | number }): void {
  if (!isSentryEnabled()) {
    return;
  }

  Sentry.setUser({ id: String(userId) });
}

/**
 * Clear user context (call on logout).
 */
export function clearSentryUser(): void {
  if (!isSentryEnabled()) {
    return;
  }

  Sentry.setUser(null);
}

/**
 * Capture an exception manually.
 * @public
 */
export function captureException({
  error,
  context,
}: {
  error: Error | unknown;
  context?: Record<string, unknown>;
}): void {
  if (!isSentryEnabled()) {
    return;
  }

  Sentry.captureException(error, {
    extra: context,
  });
}

/**
 * Add breadcrumb for debugging context.
 * @public
 */
export function addBreadcrumb({
  category,
  message,
  level,
  data,
}: {
  category: string;
  message: string;
  level?: 'debug' | 'info' | 'warning' | 'error';
  data?: Record<string, unknown>;
}): void {
  if (!isSentryEnabled()) {
    return;
  }

  Sentry.addBreadcrumb({
    category,
    message,
    level: level || 'info',
    data,
  });
}
