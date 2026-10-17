import {
  AIModelCapabilities,
  AIModelPricing,
  AI_NATIVE_PROVIDERS,
  AI_PROVIDER,
  asAiCliProvider,
  findCliAiModel,
  isAiCliProvider,
} from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import { redisClient } from '@root/redis-client';
import { z } from 'zod';

const MODELS_DEV_URL = 'https://models.dev/api.json';
const FETCH_TIMEOUT_MS = 10_000;
const CACHE_KEY = 'ai:model-catalog';
const CACHE_TTL_SECONDS = 24 * 60 * 60;
/** A failed fetch is cached too, so an outage doesn't hold every lookup for the fetch timeout. */
const FAILURE_TTL_SECONDS = 10 * 60;
const UNAVAILABLE_FIELD = '__unavailable';

/** models.dev prices a model per API that serves it, so each connection is looked up under its own provider. */
const CATALOG_PROVIDERS = [...AI_NATIVE_PROVIDERS, 'openrouter'] as const;
const OPENROUTER_HOST = 'openrouter.ai';

export interface ModelProfile {
  name: string;
  contextWindow: number | null;
  pricing: AIModelPricing | null;
  capabilities: AIModelCapabilities | null;
}

const ProviderSchema = z.object({ models: z.record(z.string(), z.unknown()) });

const ModelSchema = z.object({
  name: z.string().optional().catch(undefined),
  cost: z.object({ input: z.number(), output: z.number() }).nullish().catch(null),
  limit: z.object({ context: z.number(), output: z.number().optional() }).nullish().catch(null),
  modalities: z
    .object({ input: z.array(z.string()) })
    .nullish()
    .catch(null),
  structured_output: z.boolean().optional().catch(undefined),
});

/** `provider/model` keys; a malformed provider or model entry is left out rather than failing the whole catalog. */
export function parseModelsDevCatalog({ raw }: { raw: unknown }): Record<string, ModelProfile> {
  const catalog: Record<string, ModelProfile> = {};

  for (const provider of CATALOG_PROVIDERS) {
    const parsedProvider = ProviderSchema.safeParse((raw as Record<string, unknown> | null)?.[provider]);
    if (!parsedProvider.success) continue;

    for (const [id, entry] of Object.entries(parsedProvider.data.models)) {
      const model = ModelSchema.safeParse(entry);
      if (!model.success) continue;

      const { name, cost, limit, modalities, structured_output } = model.data;
      catalog[`${provider}/${id}`] = {
        name: name ?? id,
        contextWindow: limit?.context ?? null,
        pricing: cost ? { inputPerMillion: cost.input, outputPerMillion: cost.output } : null,
        capabilities: modalities
          ? {
              inputs: modalities.input,
              maxOutputTokens: limit?.output ?? null,
              structuredOutput: structured_output ?? null,
            }
          : null,
      };
    }
  }

  return catalog;
}

/** Subscription CLIs are listed under the vendor's public catalog entry for the same model. */
const CLI_CATALOG_PROVIDERS = {
  [AI_PROVIDER.claudeCode]: AI_PROVIDER.anthropic,
  [AI_PROVIDER.codex]: AI_PROVIDER.openai,
} as const;

/**
 * Null for a custom endpoint other than OpenRouter: a self-hosted model has no public price.
 * A CLI alias (`sonnet`) resolves to the model it currently points at; a model typed in by hand
 * is looked up as it is.
 */
export function toCatalogKey({
  provider,
  model,
  baseUrl,
}: {
  provider: AI_PROVIDER;
  model: string;
  baseUrl?: string;
}): string | null {
  const cliProvider = asAiCliProvider({ provider });

  if (cliProvider) {
    const catalogId = findCliAiModel({ provider: cliProvider, model })?.catalogId ?? model;
    return `${CLI_CATALOG_PROVIDERS[cliProvider]}/${catalogId}`;
  }

  if (provider !== AI_PROVIDER.custom) return `${provider}/${model}`;
  return baseUrl && new URL(baseUrl).hostname === OPENROUTER_HOST ? `openrouter/${model}` : null;
}

async function fetchCatalog(): Promise<Record<string, ModelProfile>> {
  try {
    const response = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`models.dev answered ${response.status}`);

    const catalog = parseModelsDevCatalog({ raw: await response.json() });
    if (Object.keys(catalog).length === 0) logger.warn('models.dev catalog had no readable models');
    return catalog;
  } catch (error) {
    logger.warn('models.dev catalog fetch failed, model prices read as unknown', { error });
    return {};
  }
}

async function refreshCatalog(): Promise<Record<string, ModelProfile>> {
  const catalog = await fetchCatalog();
  const entries = Object.entries(catalog);
  const fields = entries.length
    ? Object.fromEntries(entries.map(([key, profile]) => [key, JSON.stringify(profile)]))
    : { [UNAVAILABLE_FIELD]: '1' };

  await redisClient
    .multi()
    .del(CACHE_KEY)
    .hset(CACHE_KEY, fields)
    .expire(CACHE_KEY, entries.length ? CACHE_TTL_SECONDS : FAILURE_TTL_SECONDS)
    .exec();

  return catalog;
}

let inflightRefresh: Promise<Record<string, ModelProfile>> | null = null;

/**
 * Price, limits and capabilities read as unknown when the public catalog doesn't know the model or can't be reached.
 * A subscription model has no per-token price, so its pricing is always null.
 */
export async function getModelProfile(spec: {
  provider: AI_PROVIDER;
  model: string;
  baseUrl?: string;
}): Promise<ModelProfile> {
  const profile = await lookupModelProfile(spec);

  return isAiCliProvider({ provider: spec.provider }) ? { ...profile, pricing: null } : profile;
}

async function lookupModelProfile({
  provider,
  model,
  baseUrl,
}: {
  provider: AI_PROVIDER;
  model: string;
  baseUrl?: string;
}): Promise<ModelProfile> {
  const unknown: ModelProfile = { name: model, contextWindow: null, pricing: null, capabilities: null };

  try {
    const key = toCatalogKey({ provider, model, baseUrl });
    if (!key) return unknown;

    const cached = await redisClient.hget(CACHE_KEY, key);
    if (cached) return JSON.parse(cached) as ModelProfile;
    if (await redisClient.exists(CACHE_KEY)) return unknown;

    inflightRefresh ??= refreshCatalog().finally(() => {
      inflightRefresh = null;
    });
    return (await inflightRefresh)[key] ?? unknown;
  } catch (error) {
    logger.error({ message: 'Model catalog lookup failed', error: error as Error }, { provider, model });
    return unknown;
  }
}
