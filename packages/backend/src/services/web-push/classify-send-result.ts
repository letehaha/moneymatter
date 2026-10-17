export type SendResultKind = 'ok' | 'gone' | 'rejected' | 'instance' | 'retry';

// The browser dropped the subscription.
const GONE_STATUSES: ReadonlySet<number> = new Set([404, 410]);
// A fault of the subscription itself.
const REJECTED_STATUSES: ReadonlySet<number> = new Set([400]);
// The push service refused this instance's VAPID JWT (bad key, clock skew, expired token) or the
// payload was too large. Not the subscription's fault, so it is never counted against it.
const INSTANCE_STATUSES: ReadonlySet<number> = new Set([401, 403, 413]);

const readStatusCode = ({ error }: { error: unknown }): number | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  const { statusCode } = error as { statusCode?: unknown };
  return typeof statusCode === 'number' ? statusCode : undefined;
};

/**
 * Sorts a push service response (or the error `web-push` threw) into what the caller does next.
 * Everything not listed, including 429, 5xx, timeouts and network errors, is `retry`.
 */
export const classifySendResult = ({ statusCode, error }: { statusCode?: number; error?: unknown }): SendResultKind => {
  const status = statusCode ?? readStatusCode({ error });

  if (status === undefined) return 'retry';
  // RFC 8030 answers 201; any 2xx means the push service took the message, and a retry would send it twice.
  if (status >= 200 && status < 300) return 'ok';
  if (GONE_STATUSES.has(status)) return 'gone';
  if (REJECTED_STATUSES.has(status)) return 'rejected';
  if (INSTANCE_STATUSES.has(status)) return 'instance';
  return 'retry';
};
