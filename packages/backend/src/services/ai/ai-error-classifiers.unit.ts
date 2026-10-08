import { describe, expect, it } from '@jest/globals';
import { ValidationError } from '@js/errors';
import { APICallError, RetryError } from 'ai';

import {
  buildModelNotServedMessage,
  classifyAiCallFailure,
  getHttpStatus,
  isAuthError,
  isConnectionError,
  isModelNotFoundError,
  isNonApiResponseError,
  isTemporaryError,
  unwrapRetryError,
} from './ai-error-classifiers';

/** What a tunnel with nothing behind it, or a plain web server, answers with. */
const HTML_ERROR_PAGE = '<html><body>The endpoint is offline (ERR_NGROK_3200)</body></html>';

function buildApiCallError({
  statusCode,
  isRetryable,
  message = 'api call failed',
  responseBody,
}: {
  statusCode?: number;
  isRetryable?: boolean;
  message?: string;
  responseBody?: string;
}): APICallError {
  return new APICallError({
    message,
    url: 'https://custom-llm.example/v1/chat/completions',
    requestBodyValues: {},
    statusCode,
    isRetryable,
    responseBody,
  });
}

function buildRetryError({ errors }: { errors: unknown[] }): RetryError {
  return new RetryError({
    message: 'Failed after 3 attempts',
    reason: 'maxRetriesExceeded',
    errors,
  });
}

describe('unwrapRetryError', () => {
  it('returns the error underneath a RetryError', () => {
    const cause = buildApiCallError({ statusCode: 404 });

    expect(unwrapRetryError({ error: buildRetryError({ errors: [new TypeError('fetch failed'), cause] }) })).toBe(
      cause,
    );
  });

  it('returns anything that is not a RetryError untouched', () => {
    const error = new Error('boom');

    expect(unwrapRetryError({ error })).toBe(error);
  });

  it('returns the wrapper when it carries no cause', () => {
    const error = buildRetryError({ errors: [] });

    expect(unwrapRetryError({ error })).toBe(error);
  });

  // A rebound DNS record surfaces this way: the first attempt is a retryable network
  // failure and the guard refuses the second.
  it('exposes a blocked-address rejection the SDK retried over', () => {
    const blocked = new ValidationError({ message: 'blocked' });
    const error = buildRetryError({ errors: [new TypeError('fetch failed'), blocked] });

    expect(unwrapRetryError({ error })).toBeInstanceOf(ValidationError);
  });
});

describe('isConnectionError', () => {
  it('treats an APICallError without a status code as unreachable', () => {
    expect(isConnectionError({ error: buildApiCallError({ isRetryable: true }) })).toBe(true);
  });

  it('treats an answered request as reachable', () => {
    expect(isConnectionError({ error: buildApiCallError({ statusCode: 401 }) })).toBe(false);
  });

  it.each(['fetch failed', 'Failed to fetch'])('treats a %p TypeError as unreachable', (message) => {
    expect(isConnectionError({ error: new TypeError(message) })).toBe(true);
  });

  // AbortSignal.timeout rejects with a TimeoutError, an explicit abort with an AbortError.
  it.each(['TimeoutError', 'AbortError'])('treats a %s abort as unreachable', (name) => {
    const error = Object.assign(new Error('The operation was aborted'), { name });
    expect(isConnectionError({ error })).toBe(true);
  });

  it('unwraps a RetryError to classify its last cause', () => {
    expect(isConnectionError({ error: buildRetryError({ errors: [buildApiCallError({ isRetryable: true })] }) })).toBe(
      true,
    );
    expect(isConnectionError({ error: buildRetryError({ errors: [buildApiCallError({ statusCode: 500 })] }) })).toBe(
      false,
    );
  });

  it('returns false for an unrelated plain error', () => {
    expect(isConnectionError({ error: new Error('boom') })).toBe(false);
  });
});

describe('isNonApiResponseError', () => {
  it('treats an HTML error page as a non-API answer', () => {
    const error = buildApiCallError({ statusCode: 404, responseBody: HTML_ERROR_PAGE });

    expect(isNonApiResponseError({ error })).toBe(true);
  });

  it('treats an answer with an empty body as a non-API answer', () => {
    expect(isNonApiResponseError({ error: buildApiCallError({ statusCode: 502, responseBody: '' }) })).toBe(true);
  });

  it.each(['', HTML_ERROR_PAGE])('does not treat a 429 with body %p as a non-API answer', (responseBody) => {
    expect(isNonApiResponseError({ error: buildApiCallError({ statusCode: 429, responseBody }) })).toBe(false);
  });

  it('treats a JSON error body as an API answer', () => {
    const error = buildApiCallError({
      statusCode: 404,
      responseBody: JSON.stringify({ error: { message: 'model not found', code: 'model_not_found' } }),
    });

    expect(isNonApiResponseError({ error })).toBe(false);
  });

  it('returns false when the request never reached a server', () => {
    expect(isNonApiResponseError({ error: buildApiCallError({ isRetryable: true }) })).toBe(false);
  });

  it('returns false when the failure carries no body at all to judge', () => {
    expect(isNonApiResponseError({ error: buildApiCallError({ statusCode: 404 }) })).toBe(false);
  });

  it('unwraps a RetryError to classify its last cause', () => {
    const error = buildRetryError({ errors: [buildApiCallError({ statusCode: 404, responseBody: HTML_ERROR_PAGE })] });

    expect(isNonApiResponseError({ error })).toBe(true);
  });

  it('returns false for an error the SDK did not raise', () => {
    expect(isNonApiResponseError({ error: new Error('boom') })).toBe(false);
  });
});

describe('getHttpStatus', () => {
  it('reports the status the endpoint answered with', () => {
    expect(getHttpStatus({ error: buildApiCallError({ statusCode: 503 }) })).toBe(503);
  });

  it('reports nothing for an error that never got an answer', () => {
    expect(getHttpStatus({ error: new TypeError('fetch failed') })).toBeUndefined();
  });
});

describe('isModelNotFoundError', () => {
  it('treats any 404 as a missing model', () => {
    expect(isModelNotFoundError({ error: buildApiCallError({ statusCode: 404 }) })).toBe(true);
  });

  it('does not treat a 404 web page as a missing model', () => {
    const error = buildApiCallError({ statusCode: 404, responseBody: HTML_ERROR_PAGE });

    expect(isModelNotFoundError({ error })).toBe(false);
  });

  it.each([
    'model_not_found',
    'model "llama3.2" not found, try pulling it first',
    'The model `qwen2.5` does not exist',
    'unknown model requested',
  ])('treats a 400 saying %p as a missing model', (message) => {
    expect(isModelNotFoundError({ error: buildApiCallError({ statusCode: 400, message }) })).toBe(true);
  });

  it('treats a 422 with an explicit marker as a missing model', () => {
    const error = buildApiCallError({ statusCode: 422, message: 'model not found' });
    expect(isModelNotFoundError({ error })).toBe(true);
  });

  it('does not treat a 400 that merely echoes the request path as a missing model', () => {
    const error = buildApiCallError({ statusCode: 400, message: 'Invalid request body sent to /v1/chat/completions' });
    expect(isModelNotFoundError({ error })).toBe(false);
  });

  it('does not treat a 500 mentioning the model as a missing model', () => {
    const error = buildApiCallError({ statusCode: 500, message: 'model not found' });
    expect(isModelNotFoundError({ error })).toBe(false);
  });

  it('unwraps a RetryError to classify its last cause', () => {
    const error = buildRetryError({ errors: [buildApiCallError({ statusCode: 404 })] });
    expect(isModelNotFoundError({ error })).toBe(true);
  });

  it('returns false for an error the SDK did not raise', () => {
    expect(isModelNotFoundError({ error: new Error('model not found') })).toBe(false);
  });
});

describe('buildModelNotServedMessage', () => {
  it('names the model without its provider prefix', () => {
    expect(buildModelNotServedMessage({ modelId: 'custom/llama3.2' })).toContain('"llama3.2"');
  });
});

describe('isTemporaryError', () => {
  it('returns true for a 429 rate-limit APICallError', () => {
    expect(isTemporaryError({ error: buildApiCallError({ statusCode: 429 }) })).toBe(true);
  });

  it('returns false for a 401 APICallError (auth error, not temporary)', () => {
    const error = buildApiCallError({ statusCode: 401 });
    expect(isTemporaryError({ error })).toBe(false);
    expect(isAuthError({ error })).toBe(true);
  });

  it('returns true for an isRetryable APICallError with no statusCode (connection/header timeout)', () => {
    expect(isTemporaryError({ error: buildApiCallError({ isRetryable: true }) })).toBe(true);
  });

  it('returns true for a RetryError wrapping a header-timeout APICallError', () => {
    const timeoutError = buildApiCallError({ isRetryable: true });
    expect(isTemporaryError({ error: buildRetryError({ errors: [timeoutError] }) })).toBe(true);
  });

  it('returns false for a RetryError wrapping a 401 APICallError', () => {
    const authError = buildApiCallError({ statusCode: 401 });
    expect(isTemporaryError({ error: buildRetryError({ errors: [authError] }) })).toBe(false);
  });

  it('returns false for an unrelated plain error', () => {
    expect(isTemporaryError({ error: new Error('boom') })).toBe(false);
  });
});

describe('isAuthError', () => {
  it.each([401, 403])('returns true for a %d APICallError', (statusCode) => {
    expect(isAuthError({ error: buildApiCallError({ statusCode }) })).toBe(true);
  });

  it('returns true for the 400 Gemini answers a bad key with', () => {
    const responseBody = JSON.stringify({ error: { code: 400, details: [{ reason: 'API_KEY_INVALID' }] } });
    expect(isAuthError({ error: buildApiCallError({ statusCode: 400, responseBody }) })).toBe(true);
  });

  it.each([
    'Your credit balance is too low to access the Anthropic API.',
    'You have reached your specified API usage limits.',
  ])('returns true for the 400 Anthropic answers an exhausted budget with: %s', (message) => {
    expect(isAuthError({ error: buildApiCallError({ statusCode: 400, message }) })).toBe(true);
  });

  it('returns false for an unrelated 400', () => {
    expect(isAuthError({ error: buildApiCallError({ statusCode: 400, message: 'max_tokens too large' }) })).toBe(false);
  });

  it('ignores auth-sounding text when the SDK carries a non-auth status', () => {
    expect(isAuthError({ error: buildApiCallError({ statusCode: 429, message: 'invalid api key' }) })).toBe(false);
  });

  it('falls back to the message when no status code is available', () => {
    expect(isAuthError({ error: new Error('Unauthorized: token rejected') })).toBe(true);
    expect(isAuthError({ error: new Error('boom') })).toBe(false);
  });
});

// A reshuffle of this precedence silently changes which endpoints get flagged dead and
// which keys get blamed.
describe('classifyAiCallFailure', () => {
  it('reports a blocked address first, even when the SDK retried over it', () => {
    const blocked = new ValidationError({ message: 'blocked' });
    const error = buildRetryError({ errors: [new TypeError('fetch failed'), blocked] });

    expect(classifyAiCallFailure({ error })).toEqual({ kind: 'blocked-address', cause: blocked, httpStatus: null });
  });

  it('reports a connection failure as endpoint-down', () => {
    const { kind, httpStatus } = classifyAiCallFailure({ error: new TypeError('fetch failed') });

    expect(kind).toBe('endpoint-down');
    expect(httpStatus).toBeNull();
  });

  it('reads an HTML 404 as endpoint-down, not model-not-found', () => {
    const error = buildApiCallError({ statusCode: 404, responseBody: HTML_ERROR_PAGE });

    expect(classifyAiCallFailure({ error })).toMatchObject({ kind: 'endpoint-down', httpStatus: 404 });
  });

  it('reads a JSON 404 as model-not-found', () => {
    const error = buildApiCallError({ statusCode: 404, responseBody: JSON.stringify({ error: 'no such model' }) });

    expect(classifyAiCallFailure({ error })).toMatchObject({ kind: 'model-not-found', httpStatus: 404 });
  });

  it("reads OpenRouter's 404 for input the model can't take as unsupported-request, not model-not-found", () => {
    const error = buildApiCallError({
      statusCode: 404,
      message: 'No endpoints found that support image input',
      responseBody: JSON.stringify({ error: { message: 'No endpoints found that support image input', code: 404 } }),
    });

    expect(classifyAiCallFailure({ error })).toMatchObject({ kind: 'unsupported-request', httpStatus: 404 });
  });

  it('reads a JSON 401 as auth', () => {
    const error = buildApiCallError({ statusCode: 401, responseBody: JSON.stringify({ error: 'bad key' }) });

    expect(classifyAiCallFailure({ error })).toMatchObject({ kind: 'auth', httpStatus: 401 });
  });

  it('reads a 402 Payment Required as auth', () => {
    const error = buildApiCallError({ statusCode: 402, responseBody: JSON.stringify({ error: 'payment required' }) });

    expect(classifyAiCallFailure({ error })).toMatchObject({ kind: 'auth', httpStatus: 402 });
  });

  it('reads a billing refusal as auth on a non-429 status', () => {
    const error = buildApiCallError({
      statusCode: 400,
      message: 'inference prohibited, please enter a payment method in https://deepinfra.com/dash/billing',
      responseBody: JSON.stringify({ detail: { error: 'inference prohibited' } }),
    });

    expect(classifyAiCallFailure({ error })).toMatchObject({ kind: 'auth', httpStatus: 400 });
  });

  it('reads a 429 that mentions a payment method as rate-limited', () => {
    const error = buildApiCallError({
      statusCode: 429,
      message: 'Rate limit reached. Add a payment method to increase your rate limit.',
    });

    expect(classifyAiCallFailure({ error })).toMatchObject({ kind: 'rate-limited', httpStatus: 429 });
  });

  // isTemporaryError accepts a 429 too, so rate-limited has to win for callers to back off.
  it('reads a JSON 429 as rate-limited, not temporary', () => {
    const error = buildApiCallError({ statusCode: 429, responseBody: JSON.stringify({ error: 'slow down' }) });

    expect(classifyAiCallFailure({ error })).toMatchObject({ kind: 'rate-limited', httpStatus: 429 });
  });

  it('reads a JSON 503 as temporary', () => {
    const error = buildApiCallError({ statusCode: 503, responseBody: JSON.stringify({ error: 'overloaded' }) });

    expect(classifyAiCallFailure({ error })).toMatchObject({ kind: 'temporary', httpStatus: 503 });
  });

  it('unwraps a RetryError and reports the underlying cause', () => {
    const cause = buildApiCallError({ statusCode: 401, responseBody: JSON.stringify({ error: 'bad key' }) });
    const result = classifyAiCallFailure({ error: buildRetryError({ errors: [cause] }) });

    expect(result.kind).toBe('auth');
    expect(result.cause).toBe(cause);
  });

  it('falls back to unknown and wraps a non-Error cause', () => {
    const result = classifyAiCallFailure({ error: 'string failure' });

    expect(result.kind).toBe('unknown');
    expect(result.cause).toBeInstanceOf(Error);
    expect(result.cause.message).toBe('string failure');
    expect(result.httpStatus).toBeNull();
  });
});
