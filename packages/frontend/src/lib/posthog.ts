import { config } from '@/common/config';
import type { DemoBlockedFeature, DemoEndReason } from '@/common/const/demo';
import type { FeedbackType } from '@/components/dialogs/feedback-submission';
import type { AI_PROVIDER, BillingCycle, BillingTier, Feature, Plan } from '@bt/shared/types';
import posthog from 'posthog-js';
import type { Router } from 'vue-router';

// ============================================
// Event Types
// ============================================

/**
 * Frontend analytics events.
 *
 * Note: Completion events (bank_connected, import_completed, ai_categorization_completed)
 * are tracked on the backend for reliability - they confirm actual success.
 */
type AnalyticsEvent =
  // Demo mode
  | { event: 'demo_started'; properties: { location: 'hero' } }
  | { event: 'demo_signup_clicked'; properties: { location: 'banner' } }
  // Terminal event for a demo session. A visitor who abandons the tab and one whose
  // account the cleanup cron swept look identical in the funnel without it.
  | { event: 'demo_session_ended'; properties: { reason: DemoEndReason } }
  // A demo user reaching for a control that demo mode disables. The backend emits the
  // same event with `surface: 'api'` for requests that get as far as a 403.
  | {
      event: 'demo_feature_blocked';
      properties: { feature: DemoBlockedFeature; surface: 'restricted_control'; path: string };
    }
  // Language selector
  | { event: 'language_changed'; properties: { from_locale: string; to_locale: string } }
  | { event: 'crowdin_contribute_clicked'; properties: { current_locale: string } }
  | { event: 'language_request_board_clicked'; properties: { current_locale: string } }
  // Onboarding funnel
  | { event: 'onboarding_visited' }
  | { event: 'onboarding_completed'; properties: { base_currency: string } }
  // Account creation funnel
  | { event: 'account_creation_opened' }
  | { event: 'account_created'; properties: { currency: string } }
  // Bank connection funnel (bank_connected tracked on backend)
  | { event: 'bank_connection_opened'; properties: { provider: string } }
  // Transaction creation funnel
  | { event: 'transaction_creation_opened' }
  | { event: 'transaction_created'; properties: { transaction_type: 'income' | 'expense' | 'transfer' } }
  | { event: 'transaction_template_applied' }
  | { event: 'transaction_template_saved' }
  // Tracker creation funnel
  | { event: 'tracker_creation_opened' }
  | { event: 'tracker_created' }
  // Import funnel (import_completed tracked on backend)
  | {
      event: 'import_opened';
      properties: { import_type: 'csv' | 'statement_parser' | 'ynab' | 'budget-bakers-wallet' | 'ms-money' | 'ofx' };
    }
  // AI features (ai_categorization_completed tracked on backend)
  | { event: 'ai_feature_used'; properties: { feature: 'statement_parser' | 'categorization' | 'invoice_matching' } }
  | { event: 'invoice_attached'; properties: { method: 'link' | 'create' } }
  | { event: 'ai_settings_visited' }
  | { event: 'automations_mcp_tip_opened' }
  | { event: 'ai_connection_created'; properties: { provider: AI_PROVIDER } }
  // Transactions filter bar (which filters people actually use — informs which
  // ones to pin or rank higher in the "+ add filter" menu)
  | { event: 'transactions_filter_added'; properties: { filter: string } }
  | { event: 'transactions_filter_removed'; properties: { filter: string } }
  | { event: 'transactions_filter_used'; properties: { filter: string } }
  // Dashboard customization
  | { event: 'dashboard_edit_opened' }
  | { event: 'dashboard_layout_saved'; properties: { widget_count: number } }
  | { event: 'dashboard_widget_config_saved'; properties: { widget_id: string } }
  // FIRE planner
  | { event: 'fire_page_viewed' }
  | { event: 'fire_assumption_changed'; properties: { field: string } }
  | { event: 'fire_widget_added' }
  // Billing (completions, cancellations and refunds live in Stripe)
  | { event: 'paywall_hit'; properties: { feature: Feature; required_plan: Plan; path: string } }
  | { event: 'checkout_opened'; properties: { tier: BillingTier; cycle: BillingCycle; plan: Plan | null } }
  // Feedback
  | { event: 'feedback_button_clicked' }
  | { event: 'feedback_button_hovered' }
  | {
      event: 'user_feedback_submitted';
      properties: {
        feedback_type: FeedbackType;
        message: string;
      };
    };

// ============================================
// Core Functions
// ============================================

/**
 * Check if PostHog should be enabled.
 * Only enabled in production with valid API key.
 */
function isPostHogEnabled(): boolean {
  const isProduction = import.meta.env.PROD;
  const hasKey = Boolean(config.posthogKey);

  return isProduction && hasKey;
}

/**
 * Initialize PostHog analytics.
 * Should be called early in app initialization.
 */
export function initPostHog(): void {
  const posthogKey = config.posthogKey;
  if (!isPostHogEnabled() || !posthogKey) {
    return;
  }

  posthog.init(posthogKey, {
    // Use reverse proxy to bypass ad blockers (nginx proxies /helper to PostHog)
    api_host: config.posthogHost || '/helper',
    // Required when using proxy - keeps dashboard links working
    ui_host: 'https://eu.posthog.com',
    // Disable automatic pageview capture - we track specific events instead
    capture_pageview: false,
    // Pairs with the manual $pageview below: gives each page a duration and marks the
    // last page of a session as the exit page.
    capture_pageleave: true,
    // IMPORTANT: Disable autocapture to save quota
    // Autocapture tracks every click, form submit, input change - very expensive
    autocapture: false,
    // Recording starts off. `startSessionRecording` turns it on per session.
    disable_session_recording: true,
    // Surveys are configured in the PostHog dashboard, not here. Set explicitly since it reads
    // like another quota knob to flip off alongside autocapture, which would silently kill
    // every running survey. Demo-only targeting uses the `is_demo` person property `identifyUser` sets.
    disable_surveys: false,
    // The survey close button hardcodes a white background and black icon, which global.css
    // can't reach inside the shadow root. Theme colors come from the variables set there.
    prepare_external_dependency_stylesheet: (style) => {
      style.textContent +=
        '.form-cancel{background:var(--ph-survey-background-color)}.form-cancel path{stroke:var(--ph-survey-text-primary-color)}';
      return style;
    },
    // Respect Do Not Track
    respect_dnt: true,
    // Persistence
    persistence: 'localStorage+cookie',
    // Cross-subdomain cookies
    cross_subdomain_cookie: false,
    // Silently handle errors (e.g., when blocked by ad blockers)
    on_request_error: () => {
      // Silently ignore - user likely has an ad blocker
    },
  });
}

/**
 * Tracks a typed analytics event tagged with source: 'fe'.
 * Returns false when the event has nowhere to go, so callers can skip promising the user it landed.
 * True still overstates it: an ad blocker can drop the request, and on_request_error stays quiet.
 */
export function trackAnalyticsEvent(eventData: AnalyticsEvent): boolean {
  if (!isPostHogEnabled()) {
    return false;
  }

  // respect_dnt turns capture into a no-op for Do Not Track browsers.
  if (posthog.has_opted_out_capturing()) {
    return false;
  }

  const { event, ...rest } = eventData as AnalyticsEvent & { properties?: Record<string, unknown> };
  const properties = 'properties' in rest ? rest.properties : undefined;

  posthog.capture(event, {
    source: 'fe',
    ...properties,
  });

  return true;
}

/**
 * Identify a user after login.
 * Call this when user logs in or session is restored.
 */
export function identifyUser({
  userId,
  email,
  properties,
}: {
  userId: string | number;
  email?: string;
  properties?: Record<string, unknown>;
}): void {
  if (!isPostHogEnabled()) {
    return;
  }

  posthog.identify(String(userId), { email, ...properties });
}

/**
 * Callers limit this to demo accounts: demo data isn't real finances, so recording is safe,
 * and the narrow cohort keeps quota small while still showing what first-time visitors do
 * before leaving.
 */
export function startSessionRecording(): void {
  if (!isPostHogEnabled()) {
    return;
  }

  posthog.startSessionRecording();
}

/**
 * Reset user identification (call on logout).
 */
export function resetUser(): void {
  if (!isPostHogEnabled()) {
    return;
  }

  posthog.reset();
}

/**
 * Track $pageview events on SPA route changes.
 * Since capture_pageview is disabled (to avoid duplicate on initial load),
 * we manually capture pageviews via router.afterEach.
 */
export function trackPageviews({ router }: { router: Router }): void {
  if (!isPostHogEnabled()) {
    return;
  }

  router.afterEach((to) => {
    posthog.capture('$pageview', {
      $current_url: window.location.href,
      $pathname: to.path,
    });
  });
}
