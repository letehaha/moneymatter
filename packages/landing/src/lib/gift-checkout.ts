import { GIFT_ERRORS } from '@/i18n/client';

import { config } from './config';
import type { PlanId } from './plans';
import { analyticsLoading, trackAnalyticsEvent } from './posthog';

const TOO_MANY_REQUESTS = 429;

export type GiftCheckoutOutcome = 'redirected' | 'rate_limited' | 'rejected' | 'server_error' | 'network';

export type GiftCheckoutBody = {
  tier: Extract<PlanId, 'essential' | 'plus'>;
  buyerName: string;
  buyerEmail: string;
  recipientName: string;
  recipientEmail: string;
  message?: string;
  deliverAt?: string;
  returnPath?: string;
};

type GiftCheckoutApiResponse = { response?: { url?: string } };

export async function startGiftCheckout({
  body,
}: {
  body: GiftCheckoutBody;
}): Promise<{ url: string } | { error: string }> {
  const track = ({ outcome, status }: { outcome: GiftCheckoutOutcome; status?: number }) =>
    trackAnalyticsEvent({
      event: 'landing_gift_checkout_started',
      properties: { tier: body.tier, scheduled: Boolean(body.deliverAt), outcome, status },
    });

  let response: Response;

  try {
    response = await fetch(`${config.apiHttp}${config.apiVer}/billing/gifts/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    console.error('Failed to start the gift checkout:', error);
    track({ outcome: 'network' });
    return { error: GIFT_ERRORS.network };
  }

  let json: GiftCheckoutApiResponse = {};
  try {
    json = await response.json();
  } catch (error) {
    console.error(`Gift checkout response (${response.status}) is not JSON:`, error);
  }

  if (!response.ok) console.error(`Gift checkout failed with ${response.status}:`, json);

  if (response.status === TOO_MANY_REQUESTS) {
    track({ outcome: 'rate_limited', status: response.status });
    return { error: GIFT_ERRORS.rateLimited };
  }

  if (response.status >= 400 && response.status < 500) {
    track({ outcome: 'rejected', status: response.status });
    return { error: GIFT_ERRORS.failed };
  }

  const url = json.response?.url;
  if (!response.ok || !url) {
    track({ outcome: 'server_error', status: response.status });
    return { error: GIFT_ERRORS.failed };
  }

  track({ outcome: 'redirected' });
  // Navigating away unloads the page before a queued event is sent.
  await Promise.race([analyticsLoading(), new Promise((resolve) => setTimeout(resolve, 300))]);
  return { url };
}
