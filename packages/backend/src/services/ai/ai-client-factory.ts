import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { AINativeProvider, AI_FEATURE, AI_PROVIDER } from '@bt/shared/types';
import { createGuardedFetch } from '@common/utils/url-guard';
import type { LanguageModel } from 'ai';
import { Agent } from 'undici';

import { CUSTOM_ENDPOINT_CALL_TIMEOUT_MS } from './ai-call-guards';
import { resolveAIConfiguration } from './ai-model-resolver';

/** Node's fetch otherwise gives up after 300s without response headers, which a non-streaming local model can exceed. */
const customEndpointDispatcher = new Agent({
  headersTimeout: CUSTOM_ENDPOINT_CALL_TIMEOUT_MS,
  bodyTimeout: CUSTOM_ENDPOINT_CALL_TIMEOUT_MS,
});

/**
 * Passed explicitly so the SDKs never fall back to `*_BASE_URL` env vars, which could point
 * a user's key somewhere other than the provider's official API.
 */
export const NATIVE_PROVIDER_BASE_URLS: Record<AINativeProvider, string> = {
  [AI_PROVIDER.openai]: 'https://api.openai.com/v1',
  [AI_PROVIDER.anthropic]: 'https://api.anthropic.com/v1',
  [AI_PROVIDER.google]: 'https://generativelanguage.googleapis.com/v1beta',
};

export interface AIClientResult {
  model: LanguageModel;
  provider: AI_PROVIDER;
  /** `provider/model` format */
  modelId: string;
  usingUserKey: boolean;
  /** Set when one of the user's connections answers */
  connectionId?: string;
}

/** `baseUrl` is required on the custom arm so a custom connection can never dial a provider's public API. */
export type ProviderModelSpec =
  | { provider: AINativeProvider; model: string; apiKey: string }
  | { provider: AI_PROVIDER.custom; model: string; apiKey: string | null; baseUrl: string };

export function createProviderModel(spec: ProviderModelSpec): LanguageModel {
  if (spec.provider === AI_PROVIDER.custom) {
    const custom = createOpenAI({
      // Ollama and vLLM accept any bearer token, and the placeholder stops the SDK from
      // falling back to the server's OPENAI_API_KEY env var.
      apiKey: spec.apiKey || 'no-key-required',
      baseURL: spec.baseUrl,
      fetch: (input, init) =>
        createGuardedFetch()(input, { ...init, dispatcher: customEndpointDispatcher } as unknown as RequestInit),
    });
    // .chat() targets /chat/completions. The default responses-API path is not
    // served by Ollama, vLLM or most OpenAI-compatible proxies.
    return custom.chat(spec.model);
  }

  const { provider, model, apiKey } = spec;

  // An empty key would make the SDK read the server's own key from the environment.
  if (!apiKey) {
    throw new Error(`Refusing to create a ${provider} client without an API key`);
  }

  const baseURL = NATIVE_PROVIDER_BASE_URLS[provider];

  switch (provider) {
    case AI_PROVIDER.openai:
      return createOpenAI({ apiKey, baseURL })(model);
    case AI_PROVIDER.anthropic:
      return createAnthropic({ apiKey, baseURL })(model);
    case AI_PROVIDER.google:
      return createGoogleGenerativeAI({ apiKey, baseURL })(model);
    default: {
      const _exhaustiveCheck: never = provider;
      throw new Error(`Unsupported AI provider: ${_exhaustiveCheck}`);
    }
  }
}

/**
 * Creates a configured AI model instance for a given feature and user.
 * Returns null when nothing can answer the feature.
 */
export async function createAIClient({
  userId,
  feature,
  allowOperatorKey,
}: {
  userId: number;
  feature: AI_FEATURE;
  /** Grants the server key for this one call, for a feature the caller gates itself. */
  allowOperatorKey?: boolean;
}): Promise<AIClientResult | null> {
  const resolution = await resolveAIConfiguration({ userId, feature, allowOperatorKey });

  if (!resolution) {
    return null;
  }

  return {
    model: createProviderModel(resolution),
    provider: resolution.provider,
    modelId: resolution.modelId,
    usingUserKey: resolution.usingUserKey,
    connectionId: resolution.kind === 'connection' ? resolution.connectionId : undefined,
  };
}
