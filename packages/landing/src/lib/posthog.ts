import type { PostHog } from 'posthog-js';

import type { FaqOutcome } from './ask-faq';
import { config } from './config';

export type DemoStartLocation = 'hero' | 'hero_screenshot' | 'demo_link' | 'cta_section';

// Allowed `data-track-location` values per `data-track` event.
export const TRACKED_CLICK_LOCATIONS = {
  landing_cta_clicked: ['header', 'hero', 'cta_section', 'pricing'],
  landing_roadmap_clicked: ['community'],
  landing_testflight_clicked: ['hero'],
  landing_github_clicked: ['header_nav', 'header_star', 'self_host', 'cta_section', 'footer', 'community'],
  landing_reddit_clicked: ['footer', 'faq', 'reviews'],
} as const;

type TrackedClick = keyof typeof TRACKED_CLICK_LOCATIONS;

type ClickEvent = {
  [E in TrackedClick]: {
    event: E;
    properties: { location: (typeof TRACKED_CLICK_LOCATIONS)[E][number] } & (E extends 'landing_cta_clicked'
      ? { action: 'sign_up' }
      : unknown);
  };
}[TrackedClick];

type LandingAnalyticsEvent =
  | ClickEvent
  | { event: 'landing_premium_early_access_clicked'; properties: { location: 'pricing' } }
  | {
      event: 'landing_premium_early_access_submitted';
      properties: { with_email: true; email: string } | { with_email: false };
    }
  | { event: 'demo_started'; properties: { location: DemoStartLocation } }
  // `demo_started` fires on click; these two close out that funnel.
  // Setup bulk-inserts ~1.5k transactions and rebuilds balances twice, so without
  // them a slow or rejected run looks the same as a visitor who never clicked.
  | { event: 'demo_setup_succeeded'; properties: { duration_ms: number } }
  | {
      event: 'demo_setup_failed';
      properties: { reason: 'rate_limited' | 'server_error' | 'network'; status?: number };
    }
  | {
      event: 'landing_faq_asked';
      properties: {
        question: string;
        answer?: string;
        outcome: FaqOutcome;
        duration_ms: number;
        status?: number;
      };
    };

type QueuedEvent = LandingAnalyticsEvent & { timestamp: Date };

let posthog: PostHog | undefined;
let loadState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
let loading: Promise<void> | undefined;
const queue: QueuedEvent[] = [];

function isPostHogEnabled(): boolean {
  return import.meta.env.PROD && Boolean(config.posthogKey);
}

function capture({ event, properties, timestamp }: LandingAnalyticsEvent & { timestamp?: Date }): boolean {
  // Tracking runs inside user flows such as starting the demo, which must not fail with it.
  try {
    posthog!.capture(event, { source: 'landing', ...properties }, timestamp && { timestamp });
    return true;
  } catch (error) {
    console.error('Failed to track analytics event:', error);
    return false;
  }
}

function loadPostHog(): Promise<void> | undefined {
  if (loading || !isPostHogEnabled()) return loading;
  loadState = 'loading';

  loading = import('posthog-js')
    .then(({ default: client }) => {
      const firstQueuedAt = queue[0]?.timestamp;

      client.init(config.posthogKey!, {
        api_host: config.posthogHost || '/helper',
        ui_host: 'https://eu.posthog.com',
        // The landing is a static multi-page site, so built-in capture is its only pageview source.
        // The SPA captures pageviews manually on route change.
        capture_pageview: true,
        // Records dwell time and marks the landing page as an exit point.
        capture_pageleave: true,
        autocapture: false,
        disable_session_recording: true,
        respect_dnt: true,
        persistence: 'localStorage+cookie',
        cross_subdomain_cookie: false,
        on_request_error: () => {
          // Silently ignore — user likely has an ad blocker
        },
        // The initial pageview is captured on init, after any clicks queued while loading.
        // Queued events keep their click time, so the pageview moves just ahead of them to keep funnels ordered.
        before_send: (result) => {
          if (result?.event === '$pageview' && firstQueuedAt) {
            result.timestamp = new Date(firstQueuedAt.getTime() - 1);
          }
          return result;
        },
      });

      posthog = client;
      loadState = 'ready';
      queue.splice(0).forEach((item) => capture(item));
    })
    .catch((error) => {
      console.warn('PostHog failed to load:', error);
      loadState = 'failed';
      queue.length = 0;
    });
  return loading;
}

/**
 * Loads posthog-js off the critical path: on the first interaction, when the browser is idle after
 * `load` (at most 2s later), or on the first tracked event, whichever comes first.
 */
export function initPostHog(): void {
  if (!isPostHogEnabled()) return;

  for (const type of ['pointerdown', 'keydown', 'touchstart', 'scroll']) {
    addEventListener(type, loadPostHog, { once: true, passive: true });
  }

  // The 200ms fallback for browsers without requestIdleCallback (Safari) matches Astro's `client:idle`.
  const scheduleIdle = () =>
    'requestIdleCallback' in window
      ? requestIdleCallback(loadPostHog, { timeout: 2000 })
      : setTimeout(loadPostHog, 200);

  if (document.readyState === 'complete') scheduleIdle();
  else addEventListener('load', scheduleIdle, { once: true });
}

/**
 * Returns false when the event has nowhere to go (disabled, Do Not Track, capture threw, library failed to load).
 * True still overstates it: an ad blocker can drop the request, and on_request_error stays quiet.
 * Before the library is ready the event is queued and true is optimistic.
 */
export function trackAnalyticsEvent(eventData: LandingAnalyticsEvent): boolean {
  if (!isPostHogEnabled() || loadState === 'failed') return false;

  if (loadState === 'ready') {
    if (posthog!.has_opted_out_capturing()) return false;
    return capture(eventData);
  }

  queue.push({ ...eventData, timestamp: new Date() });
  loadPostHog();
  return true;
}

/** Pending while queued events wait for the library; undefined once it is ready, failed or disabled. */
export function analyticsLoading(): Promise<void> | undefined {
  return loadState === 'loading' ? loading : undefined;
}

/** Resolves true only after the event reached `posthog.capture`, false when it has nowhere to go. */
export async function deliverAnalyticsEvent(eventData: LandingAnalyticsEvent): Promise<boolean> {
  await loadPostHog();
  return trackAnalyticsEvent(eventData);
}
