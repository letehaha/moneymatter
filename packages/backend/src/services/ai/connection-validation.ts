import { AINativeProvider, AI_PROVIDER, TestAIConnectionResponse } from '@bt/shared/types';
import { assertSafeOutboundUrl, createGuardedFetch } from '@common/utils/url-guard';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import { generateText } from 'ai';

import { createProviderModel } from './ai-client-factory';
import {
  bodyReadsAsApiAnswer,
  classifyAiCallFailure,
  getHttpStatus,
  isAbortError,
  isAuthError,
  isConnectionError,
  isModelNotFoundError,
  isNonApiResponseError,
  isTemporaryError,
  unwrapRetryError,
} from './ai-error-classifiers';
import { AI_MAX_OUTPUT_TOKENS } from './ai-output-limit';

/** Kept to one word so the probe costs next to nothing. */
const VALIDATION_PROMPT = "Reply with only the word 'ok'";

/** Keeps an endpoint that connects and then trickles data from holding the request open. */
const VALIDATION_TIMEOUT_MS = 15_000;

/** `/models` is a static lookup, so a server silent this long will not return a list. */
export const MODEL_LIST_TIMEOUT_MS = 5_000;

const MAX_LISTED_MODELS_IN_ERROR = 5;

/**
 * `unusable` covers every answer that is not a readable list (404, non-JSON body,
 * unrecognised shape, empty list) and is no verdict on the endpoint.
 */
type ServedModelsOutcome =
  | { kind: 'listed'; modelIds: string[] }
  | { kind: 'unreachable'; cause: unknown }
  | { kind: 'authFailed'; status: number }
  | { kind: 'unusable' };

/** Pulls the ids out of an OpenAI-style `{ data: [{ id }] }` body, tolerating anything else. */
export function readModelIds({ body }: { body: unknown }): string[] {
  if (typeof body !== 'object' || body === null) return [];

  const { data } = body as { data?: unknown };
  if (!Array.isArray(data)) return [];

  return data
    .map((entry) => (typeof entry === 'object' && entry !== null ? (entry as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

export async function fetchServedModels({
  baseUrl,
  apiKey,
}: {
  baseUrl: string;
  apiKey: string | null;
}): Promise<ServedModelsOutcome> {
  const guardedFetch = createGuardedFetch();
  const url = `${baseUrl.replace(/\/+$/, '')}/models`;

  let response: Response;
  try {
    response = await guardedFetch(url, {
      method: 'GET',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
    });
  } catch (error) {
    // A blocked URL or refused redirect is a bad request from the user, not a bad endpoint
    if (error instanceof ValidationError) {
      throw error;
    }

    // A server too busy to list models can still answer a generate call, so the probe continues.
    if (isAbortError({ error })) {
      logger.info('Custom AI endpoint model list timed out', { baseUrl, error });
      return { kind: 'unusable' };
    }

    if (isConnectionError({ error })) {
      return { kind: 'unreachable', cause: error };
    }

    logger.info('Custom AI endpoint model list request failed', { baseUrl, error });
    return { kind: 'unusable' };
  }

  if (response.status === 401 || response.status === 403) {
    // Only a JSON answer is the API's own verdict on the key. An HTML 401 is a gate in front
    // of the server (Cloudflare Access, basic auth), so the generate probe takes over.
    const body = await response.text().catch(() => '');
    if (!bodyReadsAsApiAnswer({ body })) {
      return { kind: 'unusable' };
    }
    return { kind: 'authFailed', status: response.status };
  }

  if (!response.ok) {
    return { kind: 'unusable' };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    logger.info('Custom AI endpoint model list is not readable JSON', { baseUrl, error });
    return { kind: 'unusable' };
  }

  const modelIds = readModelIds({ body });
  return modelIds.length > 0 ? { kind: 'listed', modelIds } : { kind: 'unusable' };
}

/**
 * Prefix matches come first, because a truncated or mistyped name is the usual cause.
 * Aggregators list hundreds of ids, hence the cap and the remainder count.
 */
export function pickListedModelsToShow({ modelName, modelIds }: { modelName: string; modelIds: string[] }): {
  shown: string[];
  remaining: number;
} {
  const typed = modelName.toLowerCase();
  const related = modelIds.filter((id) => {
    const candidate = id.toLowerCase();
    return candidate.startsWith(typed) || typed.startsWith(candidate);
  });
  const ordered = [...related, ...modelIds.filter((id) => !related.includes(id))];

  return {
    shown: ordered.slice(0, MAX_LISTED_MODELS_IN_ERROR),
    remaining: Math.max(ordered.length - MAX_LISTED_MODELS_IN_ERROR, 0),
  };
}

function buildModelNotListedMessage({ modelName, modelIds }: { modelName: string; modelIds: string[] }): string {
  const { shown, remaining } = pickListedModelsToShow({ modelName, modelIds });
  const parts = [...shown];

  if (remaining > 0) {
    parts.push(t({ key: 'ai.customEndpointMoreModels', variables: { count: remaining } }));
  }

  return t({
    key: 'ai.customEndpointModelNotListed',
    variables: { model: modelName, available: parts.join(', ') },
  });
}

/**
 * A readable `/models` catalogue decides the verdict on its own, because LM Studio ignores
 * the `model` field and answers a chat completion with whatever it has loaded, so a generate
 * probe there accepts a mistyped name. Servers without `/models` fall through to the
 * generate probe.
 */
export async function validateCustomEndpoint({
  baseUrl,
  modelName,
  apiKey,
}: {
  baseUrl: string;
  modelName: string;
  apiKey: string | null;
}): Promise<TestAIConnectionResponse> {
  await assertSafeOutboundUrl({ url: baseUrl });

  const servedModels = await fetchServedModels({ baseUrl, apiKey });

  if (servedModels.kind === 'unreachable') {
    logger.info('Custom AI endpoint unreachable', { baseUrl, modelName, error: servedModels.cause });
    return { isValid: false, error: t({ key: 'ai.customEndpointUnreachable' }) };
  }

  if (servedModels.kind === 'authFailed') {
    logger.info('Custom AI endpoint rejected the API key', { baseUrl, modelName, status: servedModels.status });
    return { isValid: false, error: t({ key: 'ai.customEndpointAuthFailed' }) };
  }

  if (servedModels.kind === 'listed') {
    if (servedModels.modelIds.includes(modelName)) {
      return { isValid: true };
    }

    logger.info('Custom AI endpoint does not list the requested model', { baseUrl, modelName });
    return { isValid: false, error: buildModelNotListedMessage({ modelName, modelIds: servedModels.modelIds }) };
  }

  try {
    const model = createProviderModel({ provider: AI_PROVIDER.custom, model: modelName, apiKey, baseUrl });

    await generateText({
      model,
      prompt: VALIDATION_PROMPT,
      maxOutputTokens: 5,
      // The first response is the verdict, and the SDK's retry backoff would make the user
      // sit through sleeps on a 429.
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(VALIDATION_TIMEOUT_MS),
    });

    return { isValid: true };
  } catch (error) {
    const cause = unwrapRetryError({ error });

    // A blocked URL or refused redirect is a bad request from the user, not a bad endpoint
    if (cause instanceof ValidationError) {
      throw cause;
    }

    if (isConnectionError({ error: cause })) {
      logger.info('Custom AI endpoint unreachable', { baseUrl, modelName, error: cause });
      return { isValid: false, error: t({ key: 'ai.customEndpointUnreachable' }) };
    }

    // Runs ahead of the auth, model and rate-limit checks. An error page carries a status
    // code those would read as a verdict the server never gave.
    if (isNonApiResponseError({ error: cause })) {
      const status = getHttpStatus({ error: cause });
      logger.info('Custom AI endpoint answered with something other than an API response', {
        baseUrl,
        modelName,
        status,
        error: cause,
      });
      return { isValid: false, error: t({ key: 'ai.customEndpointNotApiResponse', variables: { status } }) };
    }

    if (isAuthError({ error: cause })) {
      logger.info('Custom AI endpoint rejected the API key', { baseUrl, modelName, error: cause });
      return { isValid: false, error: t({ key: 'ai.customEndpointAuthFailed' }) };
    }

    if (isModelNotFoundError({ error: cause })) {
      logger.info('Custom AI endpoint does not serve the requested model', { baseUrl, modelName, error: cause });
      return { isValid: false, error: t({ key: 'ai.customEndpointModelNotFound', variables: { model: modelName } }) };
    }

    if (isTemporaryError({ error: cause })) {
      // Reachable and authenticated, just busy. Logged because this is the one path that stores
      // `valid` without proof.
      logger.info('Custom AI endpoint accepted despite a temporary error', { baseUrl, modelName, error: cause });
      return { isValid: true };
    }

    logger.info('Custom AI endpoint validation failed', { baseUrl, modelName, error: cause });
    return { isValid: false, error: t({ key: 'ai.customEndpointValidationFailed' }) };
  }
}

/**
 * Probes with the full output ceiling every real call sends, so a model whose own output limit
 * is lower is refused here with the provider's message instead of failing every later run.
 */
async function validateNativeConnection({
  provider,
  model,
  apiKey,
}: {
  provider: AINativeProvider;
  model: string;
  apiKey: string | null;
}): Promise<TestAIConnectionResponse> {
  if (!apiKey) {
    return { isValid: false, error: t({ key: 'ai.connectionApiKeyRequired' }) };
  }

  try {
    await generateText({
      model: createProviderModel({ provider, model, apiKey }),
      prompt: VALIDATION_PROMPT,
      maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(VALIDATION_TIMEOUT_MS),
    });

    return { isValid: true };
  } catch (error) {
    const { kind, cause } = classifyAiCallFailure({ error });

    logger.info('AI connection validation failed', { provider, model, kind, error: cause });

    switch (kind) {
      // Says nothing about the key: a busy or rate-limited provider still authenticated it.
      case 'temporary':
      case 'rate-limited':
        return { isValid: true };
      case 'auth':
        return { isValid: false, error: t({ key: 'ai.connectionKeyRejected' }) };
      case 'model-not-found':
        return { isValid: false, error: t({ key: 'ai.connectionModelNotAvailable', variables: { model } }) };
      case 'endpoint-down':
        return { isValid: false, error: t({ key: 'ai.connectionProviderUnreachable' }) };
      default:
        return {
          isValid: false,
          error: t({ key: 'ai.connectionValidationFailed', variables: { reason: cause.message } }),
        };
    }
  }
}

export function validateConnection({
  provider,
  model,
  apiKey,
  baseUrl,
}: {
  provider: AI_PROVIDER;
  model: string;
  apiKey: string | null;
  /** Required for `custom`, ignored otherwise */
  baseUrl?: string;
}): Promise<TestAIConnectionResponse> {
  if (provider === AI_PROVIDER.claudeCode || provider === AI_PROVIDER.codex) {
    throw new Error('not wired');
  }

  if (provider !== AI_PROVIDER.custom) {
    return validateNativeConnection({ provider, model, apiKey });
  }

  if (!baseUrl) {
    return Promise.resolve({ isValid: false, error: t({ key: 'ai.connectionBaseUrlRequired' }) });
  }

  return validateCustomEndpoint({ baseUrl, modelName: model, apiKey });
}
