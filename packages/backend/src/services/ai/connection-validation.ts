import { AICliProvider, AINativeProvider, AI_PROVIDER, TestAIConnectionResponse } from '@bt/shared/types';
import { assertSafeOutboundUrl, createGuardedFetch } from '@common/utils/url-guard';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import { APICallError, generateText } from 'ai';

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
import { CliCredentialSource } from './cli/cli-credential-run';
import { CLI_PROVIDER_LABEL, isCliNotInstalledError, redactCliSecrets } from './cli/cli-errors';
import { CLI_PROBE_MAX_WAIT_MS, CLI_PROBE_RUN_TIMEOUT_MS, CliSlotBusyError } from './cli/cli-run-limiter';

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

/** Queue wait plus run, with slack: the probe's own limits (slot wait, run timeout) normally trip first. */
const CLI_PROBE_CEILING_MS = CLI_PROBE_MAX_WAIT_MS + CLI_PROBE_RUN_TIMEOUT_MS + 10_000;

/** The CLI's own words: the `error.message` of the synthetic JSON body, token patterns redacted. */
function readCliFailureReason({ cause }: { cause: Error }): string {
  if (cause instanceof APICallError && cause.responseBody) {
    try {
      const message = (JSON.parse(cause.responseBody) as { error?: { message?: unknown } }).error?.message;

      if (typeof message === 'string' && message) return redactCliSecrets({ text: message });
    } catch {
      // Not JSON: the error's own message is the fallback.
    }
  }

  return redactCliSecrets({ text: cause.message });
}

/**
 * The verdict for a failed CLI probe. It differs from the native table because every CLI failure
 * that has no better class arrives as a synthetic 502: treating `temporary` as valid, as native
 * providers do, would store `valid` on a connection whose every run then fails as "temporarily
 * unavailable" and is never flagged. Only the signals that prove the sign-in and model work count:
 * the subscription limit (429) and an overloaded service (503).
 */
export function judgeCliProbeFailure({
  provider,
  model,
  error,
}: {
  provider: AICliProvider;
  model: string;
  error: unknown;
}): TestAIConnectionResponse {
  const label = CLI_PROVIDER_LABEL[provider];

  if (isCliNotInstalledError({ error })) {
    return { isValid: false, error: t({ key: 'ai.cliNotInstalled', variables: { provider: label } }) };
  }

  const { kind, cause, httpStatus } = classifyAiCallFailure({ error });

  switch (kind) {
    case 'rate-limited':
      return { isValid: true };
    case 'temporary':
      return httpStatus === 503
        ? { isValid: true }
        : {
            isValid: false,
            error: t({ key: 'ai.connectionValidationFailed', variables: { reason: readCliFailureReason({ cause }) } }),
          };
    case 'auth':
      return { isValid: false, error: t({ key: 'ai.cliSignInRejected', variables: { provider: label } }) };
    case 'model-not-found':
      return { isValid: false, error: t({ key: 'ai.cliModelNotAvailable', variables: { provider: label, model } }) };
    case 'endpoint-down':
      return { isValid: false, error: t({ key: 'ai.connectionProviderUnreachable' }) };
    default:
      return {
        isValid: false,
        error: t({ key: 'ai.connectionValidationFailed', variables: { reason: readCliFailureReason({ cause }) } }),
      };
  }
}

/**
 * Probes a subscription CLI through the model's own `doGenerate`, so the probe takes the
 * connection's slot like any run and loads the credential from `credentialSource` inside it.
 * `onValid` runs while the slot is still held and only for a passing probe (a session that is
 * consumed there cannot be read, refreshed and written back by a concurrent probe afterwards).
 * A slot that stays busy past the wait limit is not a verdict: it throws `ai.cliConnectionBusy`.
 */
export async function validateCliConnection({
  provider,
  model,
  credentialSource,
  onValid,
}: {
  provider: AICliProvider;
  model: string;
  credentialSource: CliCredentialSource;
  onValid?: () => Promise<void> | void;
}): Promise<TestAIConnectionResponse> {
  try {
    await generateText({
      model: createProviderModel({
        provider,
        model,
        credentialSource,
        runOptions: {
          timeoutMs: CLI_PROBE_RUN_TIMEOUT_MS,
          maxWaitMs: CLI_PROBE_MAX_WAIT_MS,
          beforeRelease: async ({ outcome }) => {
            const verdict = outcome.ok
              ? { isValid: true }
              : judgeCliProbeFailure({ provider, model, error: outcome.error });

            if (verdict.isValid) await onValid?.();
          },
        },
      }),
      prompt: VALIDATION_PROMPT,
      maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(CLI_PROBE_CEILING_MS),
    });

    return { isValid: true };
  } catch (error) {
    const cause = unwrapRetryError({ error });

    if (cause instanceof CliSlotBusyError) {
      throw new ValidationError({ message: t({ key: 'ai.cliConnectionBusy' }) });
    }

    // From `onValid` or the credential source (an unusable session, an unreadable stored key):
    // a problem with the request, not a verdict on the CLI.
    if (cause instanceof ValidationError || cause instanceof NotFoundError) {
      throw cause;
    }

    logger.info('CLI connection validation failed', { provider, model, error: cause });

    return judgeCliProbeFailure({ provider, model, error: cause });
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
    throw new Error('CLI providers are probed with validateCliConnection');
  }

  if (provider !== AI_PROVIDER.custom) {
    return validateNativeConnection({ provider, model, apiKey });
  }

  if (!baseUrl) {
    return Promise.resolve({ isValid: false, error: t({ key: 'ai.connectionBaseUrlRequired' }) });
  }

  return validateCustomEndpoint({ baseUrl, modelName: model, apiKey });
}
