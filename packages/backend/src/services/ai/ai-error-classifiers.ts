import { getModelNameFromModelId } from '@bt/shared/types';
import { ValidationError } from '@js/errors';
import { APICallError, RetryError } from 'ai';

// Shared classifiers for AI SDK failures, so every feature reports the same cause for the
// same error. `classifyAiCallFailure` is the entry point.

/** Markers an OpenAI-compatible server puts in a 400/422 body when it does not serve the model. */
const MODEL_NOT_FOUND_MARKERS = ['model_not_found', 'not found', 'does not exist', 'unknown model'];

/**
 * OpenRouter's 404 when the model exists but none of its providers can take the request,
 * such as an image sent to a text-only model.
 */
const UNSUPPORTED_REQUEST_MARKER = 'no endpoints found that';

/**
 * The SDK hides the error that actually ended the call inside a RetryError, so classifying
 * the outer error misreads a blocked address or a rejected key.
 */
export function unwrapRetryError({ error }: { error: unknown }): unknown {
  let current = error;

  while (current instanceof RetryError && current.lastError !== undefined) {
    current = current.lastError;
  }

  return current;
}

export function isAbortError({ error }: { error: unknown }): boolean {
  const cause = unwrapRetryError({ error });
  if (!(cause instanceof Error)) return false;
  return cause.name === 'AbortError' || cause.name === 'TimeoutError';
}

/**
 * True when the request never reached an HTTP server: DNS failure, connection refused,
 * TLS failure or socket timeout. The AI SDK wraps these as an APICallError with no
 * statusCode and `isRetryable: true`, so check this before `isTemporaryError`.
 */
export function isConnectionError({ error }: { error: unknown }): boolean {
  const cause = unwrapRetryError({ error });

  if (isAbortError({ error: cause })) {
    return true;
  }
  if (cause instanceof APICallError) {
    return cause.statusCode === undefined;
  }
  if (cause instanceof TypeError) {
    const message = cause.message.toLowerCase();
    return message.includes('fetch failed') || message.includes('failed to fetch');
  }
  return false;
}

/**
 * An OpenAI-compatible server describes every refusal in JSON, so a web page or an empty
 * body means something else answered. A missing (`undefined`) body carries no evidence
 * either way and counts as an API answer.
 */
export function bodyReadsAsApiAnswer({ body }: { body: string | undefined }): boolean {
  if (body === undefined) return true;

  const trimmed = body.trim();
  if (!trimmed) return false;

  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function answeredAsApi({ error }: { error: APICallError }): boolean {
  return bodyReadsAsApiAnswer({ body: error.responseBody });
}

/**
 * True when something answered over HTTP but not as an OpenAI-compatible API: the URL, or a
 * proxy in front of it, is wrong rather than the model or the key.
 */
export function isNonApiResponseError({ error }: { error: unknown }): boolean {
  const cause = unwrapRetryError({ error });

  if (!(cause instanceof APICallError)) return false;
  // No status means nothing answered, which `isConnectionError` already covers.
  if (cause.statusCode === undefined) return false;
  // Cloudflare and nginx answer a rate limit with their own HTML page, so a non-JSON 429
  // is still a limiter in front of a working API.
  if (cause.statusCode === 429) return false;

  return !answeredAsApi({ error: cause });
}

export function getHttpStatus({ error }: { error: unknown }): number | undefined {
  const cause = unwrapRetryError({ error });

  return cause instanceof APICallError ? cause.statusCode : undefined;
}

/**
 * True when the endpoint answered but does not serve the requested model: a 404, or a
 * 400/422 whose body names the model as missing. Matching the model name itself is not
 * enough, because names like "v1" or "chat" appear in unrelated error text.
 */
export function isModelNotFoundError({ error }: { error: unknown }): boolean {
  const cause = unwrapRetryError({ error });

  if (!(cause instanceof APICallError)) return false;
  // An error page answers 404 for every path, whatever model was asked for.
  if (!answeredAsApi({ error: cause })) return false;
  if (cause.statusCode === 404) return true;
  if (cause.statusCode !== 400 && cause.statusCode !== 422) return false;

  const message = cause.message.toLowerCase();
  return MODEL_NOT_FOUND_MARKERS.some((marker) => message.includes(marker));
}

function isUnsupportedRequestError({ error }: { error: unknown }): boolean {
  const cause = unwrapRetryError({ error });

  if (!(cause instanceof APICallError) || !answeredAsApi({ error: cause })) return false;
  return cause.message.toLowerCase().includes(UNSUPPORTED_REQUEST_MARKER);
}

/** `reason` is the provider's own words, which name what the model can't take. */
export function buildUnsupportedRequestMessage({ modelId, reason }: { modelId: string; reason: string }): string {
  return `The AI model "${getModelNameFromModelId({ modelId })}" can't handle this request: ${reason}. Please pick a different model in AI settings.`;
}

/** Reaches the user through job error lists rather than an HTTP response, so it stays English. */
export function buildModelNotServedMessage({ modelId }: { modelId: string }): string {
  return `The AI model "${getModelNameFromModelId({ modelId })}" is not available from its provider. Please update the model name in AI settings.`;
}

/**
 * Transient failure that must not mark the key invalid: rate limits (429), server errors
 * (5xx), timeouts (no statusCode, but the SDK flags them retryable), and retry exhaustion.
 */
export function isTemporaryError({ error }: { error: unknown }): boolean {
  if (error instanceof RetryError) {
    return error.lastError ? isTemporaryError({ error: error.lastError }) : true;
  }
  if (error instanceof APICallError) {
    const status = error.statusCode;
    if (status === 429 || (status && status >= 500) || error.isRetryable) {
      return true;
    }
  }
  return false;
}

export function isAuthError({ error }: { error: unknown }): boolean {
  if (error instanceof APICallError) {
    const status = error.statusCode;
    if (status === 401 || status === 402 || status === 403) return true;

    const text = `${error.message} ${error.responseBody ?? ''}`.toLowerCase();
    // Billing refusals (DeepInfra: "please enter a payment method") don't use a consistent status,
    // but a 429 asking to add a payment method for a higher limit is still a rate limit.
    if (status !== 429 && text.includes('payment method')) return true;
    // Gemini answers a bad key with a 400 carrying `API_KEY_INVALID`; Anthropic answers spent
    // credits and a reached spend limit with a 400.
    return (
      status === 400 &&
      ['api_key_invalid', 'api key not valid', 'credit balance', 'api usage limits'].some((marker) =>
        text.includes(marker),
      )
    );
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('invalid api key') ||
      message.includes('unauthorized') ||
      message.includes('authentication') ||
      message.includes('api key not valid') ||
      message.includes('incorrect api key')
    );
  }
  return false;
}

export type AiCallFailureKind =
  | 'blocked-address'
  | 'endpoint-down'
  | 'unsupported-request'
  | 'model-not-found'
  | 'auth'
  | 'rate-limited'
  | 'temporary'
  | 'unknown';

interface AiCallFailure {
  kind: AiCallFailureKind;
  /** The failure underneath any RetryError wrapper. */
  cause: Error;
  /** Null when the request never got a status. */
  httpStatus: number | null;
}

/**
 * One verdict for a failed AI call. The precedence is load-bearing: blocked-address >
 * endpoint-down > unsupported-request > model-not-found > auth > rate-limited > temporary >
 * unknown, because the broad predicates swallow the specific ones. `isTemporaryError`
 * accepts anything the SDK flagged retryable and `isAuthError` matches substrings in the message.
 */
export function classifyAiCallFailure({ error }: { error: unknown }): AiCallFailure {
  const unwrapped = unwrapRetryError({ error });
  const cause = unwrapped instanceof Error ? unwrapped : new Error(String(unwrapped));
  const httpStatus = getHttpStatus({ error: unwrapped }) ?? null;

  // The outbound URL guard rejects with a ValidationError: the user's endpoint address,
  // not a provider failure.
  if (unwrapped instanceof ValidationError) {
    return { kind: 'blocked-address', cause, httpStatus };
  }
  if (isConnectionError({ error: unwrapped }) || isNonApiResponseError({ error: unwrapped })) {
    return { kind: 'endpoint-down', cause, httpStatus };
  }
  if (isUnsupportedRequestError({ error: unwrapped })) {
    return { kind: 'unsupported-request', cause, httpStatus };
  }
  if (isModelNotFoundError({ error: unwrapped })) {
    return { kind: 'model-not-found', cause, httpStatus };
  }
  if (isAuthError({ error: unwrapped })) {
    return { kind: 'auth', cause, httpStatus };
  }
  if (httpStatus === 429) {
    return { kind: 'rate-limited', cause, httpStatus };
  }
  if (isTemporaryError({ error: unwrapped })) {
    return { kind: 'temporary', cause, httpStatus };
  }
  return { kind: 'unknown', cause, httpStatus };
}
