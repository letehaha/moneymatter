import { addBreadcrumb, captureException } from '@/lib/sentry';
import type { Router } from 'vue-router';

// After a deploy, hashed chunk filenames change and any code-split import the
// running app tries to load 404s. Vite dispatches `vite:preloadError` for this
// case and vue-router rejects the navigation whose lazy component failed; we
// force a hard navigation so the user lands on the fresh bundle instead of a
// blank screen. A sessionStorage counter caps how many recoveries we'll
// trigger per tab — without it, a chunk that's genuinely missing (CDN issue,
// real bug) would reload-loop the page.

const RELOAD_COUNTER_KEY = 'app:chunk-reload-attempts';
const RELOAD_TIMESTAMP_KEY = 'app:chunk-reload-timestamp';
const MAX_RELOAD_ATTEMPTS = 2;
const COUNTER_RESET_AFTER_MS = 60_000;

// Browser-specific messages a stale-chunk incident can surface with, both from
// vite:preloadError payloads and from vue-router navigation errors ("Couldn't
// resolve component" is vue-router's wrapper when the lazy import resolved to
// nothing because the preload handler suppressed the rethrow).
const STALE_CHUNK_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
  /Unable to preload CSS/i,
  /Couldn't resolve component/i,
];

/**
 * @public exported only for the unit test, which reaches these through a
 * dynamic `import()` (the module holds per-incident state, so each case needs a
 * fresh instance). Static analysis can't see that, hence the tag.
 */
export const isStaleChunkError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return STALE_CHUNK_PATTERNS.some((pattern) => pattern.test(message));
};

/** @public exported only for the unit test — see `isStaleChunkError` above. */
export const readCounter = (): number => {
  const stored = window.sessionStorage.getItem(RELOAD_COUNTER_KEY);
  const timestamp = Number(window.sessionStorage.getItem(RELOAD_TIMESTAMP_KEY) ?? 0);
  if (Date.now() - timestamp > COUNTER_RESET_AFTER_MS) return 0;
  return Number(stored ?? 0);
};

const bumpCounter = (next: number) => {
  window.sessionStorage.setItem(RELOAD_COUNTER_KEY, String(next));
  window.sessionStorage.setItem(RELOAD_TIMESTAMP_KEY, String(Date.now()));
};

// One incident produces several error signals for the same failed chunk
// (vite:preloadError first, router.onError a tick later). A single pending
// navigation timer dedupes them: the first signal schedules the navigation and
// bumps the counter once; later signals only upgrade the navigation target to
// the route the user actually wanted, so they land there instead of on the
// page they navigated away from.
let navigateTimer: number | null = null;
let pendingTarget: string | null = null;
const NAVIGATE_DEFER_MS = 50;

// Per page load: every recovery is a full navigation, so a later incident starts with a fresh module.
let capExhaustedReported = false;

/**
 * Returns `true` while a recovery navigation is scheduled (callers should
 * suppress their default error handling), `false` when the retry cap is
 * exhausted — then the incident is reported to Sentry, once per page load, so
 * the genuine deploy/CDN problem is visible instead of the user being silently
 * stranded.
 *
 * @public exported only for the unit test — see `isStaleChunkError` above.
 */
export const scheduleRecovery = ({ error, redirectTo }: { error: Error; redirectTo?: string }): boolean => {
  if (redirectTo) pendingTarget = redirectTo;
  if (navigateTimer !== null) return true;

  const current = readCounter();
  if (current >= MAX_RELOAD_ATTEMPTS) {
    if (capExhaustedReported) return false;
    capExhaustedReported = true;
    // Wrapped in a fresh error: the original chunk-failure messages are in
    // Sentry's ignoreErrors (recovered incidents are noise), so the
    // cap-exhausted report needs a message those patterns can't match.
    captureException({
      error: new Error('chunk-reload: retry cap exhausted, asset still unavailable after reloads'),
      context: { reason: 'chunk-reload-cap-exhausted', attempts: current, originalMessage: error.message },
    });
    return false;
  }
  bumpCounter(current + 1);
  navigateTimer = window.setTimeout(() => {
    if (pendingTarget) window.location.assign(pendingTarget);
    else window.location.reload();
  }, NAVIGATE_DEFER_MS);
  return true;
};

export const installChunkReloadHandler = ({ router }: { router: Router }) => {
  window.addEventListener('vite:preloadError', (event) => {
    addBreadcrumb({
      category: 'chunk-reload',
      message: 'vite:preloadError caught',
      level: 'warning',
      data: { message: event.payload.message },
    });
    // Only suppress Vite's default rethrow while recovering — otherwise let it
    // propagate so global handlers see the underlying error.
    if (scheduleRecovery({ error: event.payload })) event.preventDefault();
  });

  // The preloadError listener alone can only reload the CURRENT url; when the
  // failure happened during a route navigation, this upgrades the pending
  // recovery to land on the route the user was navigating to.
  router.onError((error, to) => {
    if (!isStaleChunkError(error)) return;
    addBreadcrumb({
      category: 'chunk-reload',
      message: 'router chunk-load error, navigating to fresh bundle',
      level: 'warning',
      data: { message: error instanceof Error ? error.message : String(error), target: to.fullPath },
    });
    scheduleRecovery({ error: error instanceof Error ? error : new Error(String(error)), redirectTo: to.fullPath });
  });
};
