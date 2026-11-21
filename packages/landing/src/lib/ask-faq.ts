import { FAQ_ERRORS } from '@/i18n/client';

import { config } from './config';
import { trackAnalyticsEvent } from './posthog';

const TOO_MANY_REQUESTS = 429;

// `unknown` marks a question about MoneyMatter that the knowledge base could not answer.
type FaqStatus = 'answered' | 'unknown' | 'off_topic';

export type FaqOutcome = FaqStatus | 'rate_limited' | 'server_error' | 'network';

export type AskFaqResult = { answer: string } | { error: string };

type FaqApiResponse = { response: { answer: string; status: FaqStatus } };

export async function askFaq({ question }: { question: string }): Promise<AskFaqResult> {
  const startedAt = Date.now();
  const track = ({ outcome, status, answer }: { outcome: FaqOutcome; status?: number; answer?: string }) =>
    trackAnalyticsEvent({
      event: 'landing_faq_asked',
      properties: { question, answer, outcome, duration_ms: Date.now() - startedAt, status },
    });

  let response: Response;

  try {
    response = await fetch(`${config.apiHttp}${config.apiVer}/landing/faq/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    console.error('Failed to ask the FAQ assistant:', error);
    track({ outcome: 'network' });
    return { error: FAQ_ERRORS.network };
  }

  if (!response.ok) {
    const isRateLimited = response.status === TOO_MANY_REQUESTS;

    track({ outcome: isRateLimited ? 'rate_limited' : 'server_error', status: response.status });
    return {
      error: isRateLimited ? FAQ_ERRORS.rateLimited : FAQ_ERRORS.server,
    };
  }

  try {
    const json: FaqApiResponse = await response.json();
    const { answer, status } = json.response;

    if (!answer) throw new Error('The response carries no answer');

    track({ outcome: status, answer });
    return { answer };
  } catch (error) {
    console.error('Failed to read the FAQ assistant response:', error);
    track({ outcome: 'server_error', status: response.status });
    return { error: FAQ_ERRORS.server };
  }
}
