import { getCurrentRequestId } from '@common/lib/cls/logging';
import { getCurrentSessionId } from '@common/lib/cls/session-id';
import { CustomError } from '@js/errors';
import winston, { format, transports } from 'winston';
import LokiTransport from 'winston-loki';

import { isSentryEnabled, Sentry } from './sentry';

/**
 * Expected client errors carry a 4xx status. Services often log-and-rethrow
 * their errors, which would otherwise send every validation/not-found failure
 * to Sentry as if it were an app bug. Those are still logged locally; they just
 * don't belong in Sentry. 5xx (including upstream BadGateway/ServiceUnavailable)
 * and any non-CustomError are real and still captured.
 */
const isExpectedClientError = (error: unknown): boolean => error instanceof CustomError && error.httpCode < 500;

/**
 * Fixed-window allowance per distinct message. Once `maxKeys` distinct messages
 * are tracked in a window, unseen ones are refused until the window rolls over.
 */
export const createMessageRateLimiter = ({
  limit,
  windowMs,
  maxKeys,
}: {
  limit: number;
  windowMs: number;
  maxKeys: number;
}) => {
  const counts = new Map<string, number>();
  let windowStart = -Infinity;

  return ({ message, now = Date.now() }: { message: string; now?: number }): boolean => {
    if (now - windowStart >= windowMs) {
      counts.clear();
      windowStart = now;
    }

    const count = counts.get(message);
    if (count === undefined && counts.size >= maxKeys) return false;
    if (count !== undefined && count >= limit) return false;

    counts.set(message, (count ?? 0) + 1);
    return true;
  };
};

// Every warn is a billed Sentry event, so a warn inside a loop would otherwise
// spend the monthly error quota and hide real errors until the next cycle.
const allowSentryWarn = createMessageRateLimiter({ limit: 20, windowMs: 60 * 60 * 1000, maxKeys: 500 });

// Many warn messages interpolate ids, so each loop iteration is a distinct message
// that the per-message limit never catches. This bounds all warns together.
const SENTRY_WARN_DAILY_KEY = 'all';
const allowAnySentryWarn = createMessageRateLimiter({ limit: 100, windowMs: 24 * 60 * 60 * 1000, maxKeys: 1 });

// Cleared by the next allowed warn, which can only happen in a new daily window.
let isDailyCapReported = false;

const transportsArray: winston.transport[] = [new transports.Console()];
const { GRAFANA_LOKI_HOST, GRAFANA_LOKI_AUTH, GRAFANA_LOKI_USER_ID } = process.env;
const isGrafanaConfigured = Boolean(GRAFANA_LOKI_HOST && GRAFANA_LOKI_AUTH && GRAFANA_LOKI_USER_ID);

// winston-loki sends every meta field as Loki structured metadata, and Loki rejects the
// whole batch if any value is not a string (null requestId, numbers, objects). winston-loki
// ignores the 400, so those batches vanish. The full record still lives in the JSON line.
export const lokiStringMetadataOnly = format((info) => {
  for (const [key, value] of Object.entries(info)) {
    if (typeof value !== 'string') delete info[key];
  }
  return info;
});

if (isGrafanaConfigured && GRAFANA_LOKI_HOST && GRAFANA_LOKI_AUTH && GRAFANA_LOKI_USER_ID) {
  transportsArray.push(
    new LokiTransport({
      host: GRAFANA_LOKI_HOST,
      basicAuth: `${GRAFANA_LOKI_USER_ID}:${GRAFANA_LOKI_AUTH}`,
      labels: {
        service: 'budget-tracker-be',
        env: process.env.NODE_ENV,
      },
      format: lokiStringMetadataOnly(),
      json: true,
      replaceTimestamp: true,
      level: 'debug',
      // winston-loki requeues failed batches with no size cap, so an extended
      // Loki outage grows the heap without bound (prod OOM risk). Dropping the
      // failed batch is fine: the Console transport keeps every line in docker logs.
      clearOnError: true,
      onConnectionError: (error) => console.log('onConnectionError', error),
    }),
  );
}

const showLogsInTests = process.env.NODE_ENV === 'test' ? process.env.SHOW_LOGS_IN_TESTS === 'true' : true;

// Error message/stack are non-enumerable, so a plain stringify of a logged Error yields `{}`.
const serializeErrors = (_key: string, value: unknown) => {
  if (value instanceof Error) return { ...value, message: value.message, stack: value.stack };
  return typeof value === 'bigint' ? value.toString() : value;
};

const createWinstonLogger = () => {
  const formats = [
    format.errors({ stack: true }),
    format.timestamp(),
    isGrafanaConfigured
      ? format.json({ replacer: serializeErrors }) // Loki requires JSON format
      : format.printf(({ timestamp, level, message, requestId, sessionId, ...meta }) => {
          // requestId and sessionId are stamped on every log call, so they stay
          // out of the console line; the rest of the metadata is appended as JSON.
          const base = `[${timestamp}] ${level}: ${message}`;
          if (Object.keys(meta).length === 0) return base;

          try {
            const serialized = JSON.stringify(meta, serializeErrors);

            return `${base} ${serialized.length > 2000 ? `${serialized.slice(0, 2000)}…[truncated]` : serialized}`;
          } catch {
            return `${base} [unserializable meta]`;
          }
        }),
  ];

  if (!isGrafanaConfigured) formats.push(format.colorize());

  return winston.createLogger({
    level: 'debug',
    format: format.combine(...formats),
    transports: transportsArray,
  });
};

const winstonLogger = createWinstonLogger();

const createLogger =
  (severity: 'info' | 'warn') =>
  (message: string, meta: Record<string, unknown> = {}) => {
    if (showLogsInTests) {
      winstonLogger.log({
        level: severity,
        message,
        requestId: getCurrentRequestId() ?? null,
        sessionId: getCurrentSessionId() ?? null,
        ...meta,
      });
    }

    if (severity !== 'warn' || !isSentryEnabled() || !allowSentryWarn({ message })) return;

    if (!allowAnySentryWarn({ message: SENTRY_WARN_DAILY_KEY })) {
      if (!isDailyCapReported) {
        isDailyCapReported = true;
        Sentry.captureMessage('Sentry warn daily cap reached; further warns are dropped from Sentry', 'warning');
      }
      return;
    }

    isDailyCapReported = false;
    Sentry.withScope((scope) => {
      scope.setExtras(meta);
      const requestId = getCurrentRequestId();
      const sessionId = getCurrentSessionId();
      if (requestId) scope.setTag('requestId', requestId);
      if (sessionId) scope.setTag('sessionId', sessionId);
      Sentry.captureMessage(message, 'warning');
    });
  };

const formatErrorToString = (error: string | Error) => {
  let message = '';

  if (error instanceof Error && error.stack) {
    // An error object is not 100% like a normal object, so
    // we have to jump through hoops to get needed info out
    // of error objects for logging.
    message = error.stack;
  } else {
    message = String(error);
  }

  return message;
};

function loggerErrorHandler(message: string, extra?: Record<string, unknown>): void;
function loggerErrorHandler(error: Error, extra?: Record<string, unknown>): void;
function loggerErrorHandler(messageParam: { message: string; error?: Error }, extra?: Record<string, unknown>): void;
function loggerErrorHandler(messageParam: { message?: string; error: Error }, extra?: Record<string, unknown>): void;
function loggerErrorHandler(
  messageParam: { message?: string; error?: Error } | string | Error,
  extra: Record<string, unknown> = {},
): void {
  let messageResult: string;

  if (typeof messageParam === 'string') {
    messageResult = messageParam;
  } else if (messageParam instanceof Error) {
    messageResult = formatErrorToString(messageParam);
  } else if (messageParam.message && messageParam.error) {
    messageResult = `${messageParam.message} \n ${formatErrorToString(messageParam.error)}`;
  } else if (messageParam.error) {
    messageResult = formatErrorToString(messageParam.error);
  } else if (messageParam.message) {
    messageResult = messageParam.message;
  } else {
    messageResult = 'Default error message from logger';
  }

  const errorObj =
    messageParam instanceof Error
      ? messageParam
      : typeof messageParam === 'object' && messageParam.error
        ? messageParam.error
        : null;
  const errorDetails = (errorObj as { details?: unknown } | null)?.details;

  if (showLogsInTests) {
    winstonLogger.error({
      message: messageResult,
      requestId: getCurrentRequestId() ?? null,
      ...extra,
      // Self-hosters without Sentry only have this line to report upstream failures.
      ...(errorDetails && typeof errorDetails === 'object' ? { errorDetails } : {}),
    });
  }

  if (isSentryEnabled()) {
    Sentry.withScope((scope) => {
      scope.setExtras(extra);
      const requestId = getCurrentRequestId();
      const sessionId = getCurrentSessionId();
      if (requestId) scope.setTag('requestId', requestId);
      if (sessionId) scope.setTag('sessionId', sessionId);

      if (errorObj) {
        // A logged 4xx is not a Sentry-worthy bug — the local log above keeps it.
        if (isExpectedClientError(errorObj)) return;

        if (typeof messageParam === 'object' && 'message' in messageParam && messageParam.message) {
          scope.setExtra('errorContext', messageParam.message);
        }
        // Surface CustomError.details so wrapped HTTP/upstream context lands
        // in Sentry — Sentry's default capture only serializes name/message/stack.
        if (errorDetails && typeof errorDetails === 'object') {
          scope.setExtras(errorDetails as Record<string, unknown>);
        }
        Sentry.captureException(errorObj);
      } else {
        Sentry.captureMessage(messageResult, 'error');
      }
    });
  }
}

const logger = {
  info: createLogger('info'),
  warn: createLogger('warn'),
  error: loggerErrorHandler,
};

export { logger };
