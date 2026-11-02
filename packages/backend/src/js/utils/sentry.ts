import { API_PREFIX } from '@root/config';
import * as Sentry from '@sentry/node';

const SENTRY_DSN = process.env.SENTRY_DSN;

const DEFAULT_TRACES_SAMPLE_RATE = 0.01;
const MAX_TRACES_SAMPLE_RATE = 0.2;

/** Caps the env-provided rate: at full sampling the monthly span quota lasts about 12 days. */
export function resolveTracesSampleRate({ raw }: { raw: string | undefined }): number {
  const rate = Number(raw);
  if (!Number.isFinite(rate) || rate <= 0) return DEFAULT_TRACES_SAMPLE_RATE;

  return Math.min(rate, MAX_TRACES_SAMPLE_RATE);
}

const UNTRACED_POLLING_TRANSACTIONS = new Set(
  [
    '/sse/events',
    '/notifications/unread-count',
    '/bank-data-providers/sync/status',
    '/user/ai/categorization/status',
    '/user/backup/restore/status',
    '/user/currencies/change-base/status',
    '/import/batch-delete/status',
  ].map((path) => `GET ${API_PREFIX}${path}`),
);

/** `name` is the root span name at sampling time: `<METHOD> <path>`, without the query string. */
export function isUntracedPollingTransaction({ name }: { name: string }): boolean {
  return UNTRACED_POLLING_TRANSACTIONS.has(name.replace(/^(\w+ )https?:\/\/[^/]+/, '$1').replace(/\/$/, ''));
}

/**
 * Matched against span descriptions. A match on a child span drops that span
 * and reparents its children; a match on a root span drops the whole
 * transaction, so every pattern must stay clear of `<METHOD> /api/v1/...`.
 */
export const IGNORED_SPAN_PATTERNS: RegExp[] = [
  // better-auth session/user/jwks reads. The `ba_*` patterns match on description
  // alone, so they drop those reads in every trace, not only get-session.
  /^(GET|handler|hook (before|after)) \/get-session( |$)/,
  /^db find(One|Many) ba_(jwks|session|user)$/,
  /^\s*select\b.*\bfrom "ba_(jwks|session|user)"/i,
  /^(START TRANSACTION|COMMIT);?$/,
  /^SET client_min_messages/,
];

/**
 * Check if Sentry should be enabled.
 * Only enabled in production with valid DSN.
 */
export function isSentryEnabled(): boolean {
  const isProduction = process.env.NODE_ENV === 'production';
  const hasDsn = Boolean(SENTRY_DSN);

  return isProduction && hasDsn;
}

/**
 * Initialize Sentry error tracking.
 * Should be called very early in app initialization (in bootstrap.ts).
 */
export function initSentry(): void {
  if (!isSentryEnabled()) {
    return;
  }

  const tracesSampleRate = resolveTracesSampleRate({ raw: process.env.SENTRY_TRACES_SAMPLE_RATE });

  Sentry.init({
    dsn: SENTRY_DSN,
    release: process.env.SENTRY_RELEASE,
    environment: process.env.NODE_ENV,
    debug: process.env.SENTRY_DEBUG === 'true',
    tracesSampler: ({ name, inheritOrSampleWith }) =>
      isUntracedPollingTransaction({ name }) ? 0 : inheritOrSampleWith(tracesSampleRate),
    ignoreSpans: IGNORED_SPAN_PATTERNS,
    // Integrations
    integrations: [
      // HTTP integration for tracing requests
      Sentry.httpIntegration({
        // These bodies carry bank provider keys and connection data.
        ignoreIncomingRequestBody: (url) => url.includes('/bank-data-providers/'),
      }),
      // Express integration
      Sentry.expressIntegration(),
      Sentry.postgresIntegration({ ignoreConnectSpans: true }),
    ],
  });
}

/**
 * Set user context for error tracking.
 * Call this in authentication middleware.
 */
export function setSentryUser({
  userId,
  email,
  username,
  sessionId,
}: {
  userId: string | number;
  email?: string;
  username?: string;
  sessionId?: string | null;
}): void {
  if (!isSentryEnabled()) {
    return;
  }

  Sentry.setUser({
    id: String(userId),
    email,
    username,
  });

  // Add sessionId as a tag for easier filtering
  if (sessionId) {
    Sentry.setTag('sessionId', sessionId);
  }
}

/**
 * Capture an exception manually.
 * @public
 */
export function captureException({
  error,
  context,
  user,
}: {
  error: Error | unknown;
  context?: Record<string, unknown>;
  user?: { id: string | number; email?: string; username?: string };
}): void {
  if (!isSentryEnabled()) {
    return;
  }

  Sentry.withScope((scope) => {
    if (context) {
      scope.setExtras(context);
    }
    if (user) {
      scope.setUser({
        id: String(user.id),
        email: user.email,
        username: user.username,
      });
    }
    Sentry.captureException(error);
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

// --- Queue monitoring helpers ---

export interface SentryTraceData {
  sentryTrace?: string;
  sentryBaggage?: string;
}

/**
 * Wrap a queue publish (job.add) with a Sentry span.
 * The callback receives trace headers to embed in job data so the consumer
 * can link back to this producer trace.
 */
export async function withQueuePublishSpan<T>({
  queueName,
  messageId,
  payloadSize,
  fn,
}: {
  queueName: string;
  messageId: string;
  payloadSize: number;
  fn: (traceData: SentryTraceData) => Promise<T>;
}): Promise<T> {
  if (!isSentryEnabled()) {
    return fn({});
  }

  return Sentry.startSpan(
    {
      name: queueName,
      op: 'queue.publish',
      attributes: {
        'messaging.message.id': messageId,
        'messaging.destination.name': queueName,
        'messaging.message.body.size': payloadSize,
      },
    },
    async () => {
      const traceData = Sentry.getTraceData();
      return fn({
        sentryTrace: traceData['sentry-trace'],
        sentryBaggage: traceData.baggage,
      });
    },
  );
}

/**
 * Wrap a queue consumer (worker processor) with a Sentry span.
 * Links the consumer span to the producer trace via headers stored in job data.
 */
export async function withQueueProcessSpan<T>({
  queueName,
  job,
  fn,
}: {
  queueName: string;
  job: {
    id?: string | null;
    data: SentryTraceData;
    attemptsMade: number;
    timestamp: number;
  };
  fn: () => Promise<T>;
}): Promise<T> {
  if (!isSentryEnabled()) {
    return fn();
  }

  const { sentryTrace, sentryBaggage } = job.data;
  const messageSize = JSON.stringify(job.data).length;
  const receiveLatency = Date.now() - job.timestamp;

  return Sentry.continueTrace({ sentryTrace, baggage: sentryBaggage }, () => {
    return Sentry.startSpan({ name: `queue_consumer:${queueName}` }, (parent) => {
      return Sentry.startSpan(
        {
          name: queueName,
          op: 'queue.process',
          attributes: {
            'messaging.message.id': job.id || 'unknown',
            'messaging.destination.name': queueName,
            'messaging.message.body.size': messageSize,
            'messaging.message.receive.latency': receiveLatency,
            'messaging.message.retry.count': job.attemptsMade,
          },
        },
        async () => {
          try {
            const result = await fn();
            parent.setStatus({ code: 1, message: 'ok' });
            return result;
          } catch (error) {
            parent.setStatus({ code: 2, message: 'error' });
            throw error;
          }
        },
      );
    });
  });
}

export { Sentry };
