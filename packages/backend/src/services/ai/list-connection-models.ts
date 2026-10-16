import { AI_PROVIDER, CLI_AI_MODELS, asAiCliProvider } from '@bt/shared/types';
import { ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';

import { NATIVE_PROVIDER_BASE_URLS } from './ai-client-factory';
import { MODEL_LIST_TIMEOUT_MS, fetchServedModels, readModelIds } from './connection-validation';

/** Gemini's `{ models: [{ name: 'models/<id>', supportedGenerationMethods }] }`, chat models only. */
export function readGeminiModelIds({ body }: { body: unknown }): string[] {
  const models = (body as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) return [];

  return models
    .filter((entry): entry is { name: string; supportedGenerationMethods?: unknown } => typeof entry?.name === 'string')
    .filter(
      ({ supportedGenerationMethods }) =>
        Array.isArray(supportedGenerationMethods) && supportedGenerationMethods.includes('generateContent'),
    )
    .map(({ name }) => name.replace(/^models\//, ''));
}

async function fetchJson({ url, headers }: { url: string; headers: Record<string, string> }): Promise<unknown> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Model list answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

async function fetchModelIds({
  provider,
  baseUrl,
  apiKey,
}: {
  provider: AI_PROVIDER;
  baseUrl?: string;
  apiKey: string | null;
}): Promise<string[]> {
  if (provider === AI_PROVIDER.custom) {
    if (!baseUrl) return [];
    const outcome = await fetchServedModels({ baseUrl, apiKey });
    return outcome.kind === 'listed' ? outcome.modelIds : [];
  }

  // Answered by `listConnectionModels` before it gets here.
  if (provider === AI_PROVIDER.claudeCode || provider === AI_PROVIDER.codex) return [];

  if (!apiKey) return [];
  const root = NATIVE_PROVIDER_BASE_URLS[provider];

  switch (provider) {
    case AI_PROVIDER.openai:
      return readModelIds({
        body: await fetchJson({ url: `${root}/models`, headers: { Authorization: `Bearer ${apiKey}` } }),
      });
    case AI_PROVIDER.anthropic:
      return readModelIds({
        body: await fetchJson({
          url: `${root}/models?limit=1000`,
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        }),
      });
    case AI_PROVIDER.google:
      return readGeminiModelIds({
        body: await fetchJson({ url: `${root}/models?pageSize=1000`, headers: { 'x-goog-api-key': apiKey } }),
      });
  }
}

/**
 * Suggestions for the model-name field, sorted and deduped. A subscription CLI has no list to
 * fetch, so it gets its curated models without a network call and in curated order (default first).
 * For the others, anything that stops the provider from listing (no key, unreachable, odd body)
 * yields an empty list; only a blocked custom URL is an error, because that one is the user's input.
 */
export async function listConnectionModels({
  provider,
  baseUrl,
  apiKey,
}: {
  provider: AI_PROVIDER;
  baseUrl?: string;
  apiKey: string | null;
}): Promise<string[]> {
  const cliProvider = asAiCliProvider({ provider });

  if (cliProvider) return CLI_AI_MODELS[cliProvider].map((model) => model.id);

  try {
    const ids = await fetchModelIds({ provider, baseUrl, apiKey });
    return [...new Set(ids)].toSorted();
  } catch (error) {
    if (error instanceof ValidationError) throw error;

    logger.info(`AI model list unavailable for provider "${provider}"`, { provider, baseUrl, error });
    return [];
  }
}
