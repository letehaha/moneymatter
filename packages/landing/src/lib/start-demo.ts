import { config } from './config';
import type { DemoStartLocation } from './posthog';
import { trackAnalyticsEvent } from './posthog';

const TOO_MANY_REQUESTS = 429;

export async function startDemo({
  location,
  replaceHistory = false,
  onError,
}: {
  location: DemoStartLocation;
  replaceHistory?: boolean;
  onError: (payload: { message: string }) => void;
}): Promise<void> {
  trackAnalyticsEvent({ event: 'demo_started', properties: { location } });
  const startedAt = Date.now();

  let response: Response;

  // Only fetch can fail for network reasons, so only it sits in the try.
  // A throw after a 200 would read as a network error, though the account already exists.
  try {
    response = await fetch(`${config.apiHttp}${config.apiVer}/demo`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Failed to start demo:', error);
    trackAnalyticsEvent({ event: 'demo_setup_failed', properties: { reason: 'network' } });
    onError({ message: "Couldn't reach the server. Please check your connection and try again." });
    return;
  }

  if (!response.ok) {
    const isRateLimited = response.status === TOO_MANY_REQUESTS;

    trackAnalyticsEvent({
      event: 'demo_setup_failed',
      properties: { reason: isRateLimited ? 'rate_limited' : 'server_error', status: response.status },
    });
    onError({
      message: isRateLimited
        ? 'Too many demo sessions from this network. Please try again in a few minutes.'
        : "Couldn't start the demo. Please try again.",
    });
    return;
  }

  // finally, so a throw from tracking still lands the visitor in the account
  // they just created rather than leaving the loading overlay up.
  try {
    trackAnalyticsEvent({ event: 'demo_setup_succeeded', properties: { duration_ms: Date.now() - startedAt } });
  } finally {
    // Backend sets session cookies automatically via Set-Cookie headers.
    // Full page load so the Vue SPA picks up the session.
    const dashboardUrl = `${config.appUrl}/dashboard`;

    if (replaceHistory) window.location.replace(dashboardUrl);
    else window.location.href = dashboardUrl;
  }
}
