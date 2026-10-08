import type { Equals, Expect } from '../type-testing';

/**
 * Supported AI providers for features like transaction categorization.
 *
 * `custom` is any OpenAI-compatible endpoint (OpenRouter, Ollama, a proxy).
 */
export enum AI_PROVIDER {
  anthropic = 'anthropic',
  openai = 'openai',
  google = 'google',
  custom = 'custom',
}

/**
 * AI-powered features that can have individual model configurations
 */
export enum AI_FEATURE {
  categorization = 'categorization',
  statementParsing = 'statement_parsing',
  investmentTransactionsParsing = 'investment_transactions_parsing',
  receiptParsing = 'receipt_parsing',
  // Future features:
  // insights = 'insights',
  // budgetSuggestions = 'budget_suggestions',
}

export interface AIModelPricing {
  /** Cost per 1M input tokens in USD */
  inputPerMillion: number;
  /** Cost per 1M output tokens in USD */
  outputPerMillion: number;
}

/** What the public model catalog lists for a model; a null field is not listed. */
export interface AIModelCapabilities {
  /** Input kinds the model accepts, e.g. `['text', 'image', 'pdf']` */
  inputs: string[];
  maxOutputTokens: number | null;
  structuredOutput: boolean | null;
}

/** Providers served through their native SDK at the official API; need an API key, take no base URL. */
export type AINativeProvider = Exclude<AI_PROVIDER, AI_PROVIDER.custom>;

export const AI_NATIVE_PROVIDERS = [
  AI_PROVIDER.openai,
  AI_PROVIDER.anthropic,
  AI_PROVIDER.google,
] as const satisfies readonly AINativeProvider[];

/**
 * Pins `AI_NATIVE_PROVIDERS` to list every native provider, which the `satisfies` above alone
 * does not. Exported only so the assertion isn't flagged as unused.
 */
export type AiNativeProvidersAreExhaustive = Expect<Equals<(typeof AI_NATIVE_PROVIDERS)[number], AINativeProvider>>;

export const MAX_AI_CONNECTIONS = 20;

export type AIConnectionStatus = 'valid' | 'invalid';

/** Connection info returned to frontend (never carries key material) */
export interface AIConnectionInfo {
  id: string;
  provider: AI_PROVIDER;
  name: string;
  /** Only for `custom`; normalized without a trailing slash */
  baseUrl?: string;
  /** Model name passed to the provider verbatim */
  model: string;
  hasApiKey: boolean;
  createdAt: string;
  status: AIConnectionStatus;
  lastValidatedAt: string;
  lastError?: string;
  invalidatedAt?: string;
}

/** Stored per feature. `connectionId: null` = explicitly the included server model. */
export interface AIFeatureConfig {
  feature: AI_FEATURE;
  connectionId: string | null;
}

/**
 * Gate UI preselection on `isConfigured`. Every other field describes what would answer a
 * call right now, which can differ from the user's stored pick.
 */
export interface AIFeatureStatus {
  feature: AI_FEATURE;
  /** Stored pick is honoured (a server pick the user can no longer use reports false). */
  isConfigured: boolean;
  /** The stored pick when `isConfigured`: a connection id, or null for the server model */
  configuredConnectionId?: string | null;
  /** `null` when nothing answers: no credentials at all, or every connection is down */
  servedBy: 'connection' | 'server' | null;
  /** `provider/model` of what answers (e.g. 'custom/llama3.2'), '' when nothing does */
  modelId: string;
  modelName: string;
  /** Price of what answers, null when the public model catalog doesn't know it */
  pricing: AIModelPricing | null;
  /** Of what answers, null when the public model catalog doesn't know it */
  capabilities: AIModelCapabilities | null;
  usingUserKey: boolean;
  /** The answering connection; the first connection when all of them are down */
  connectionId?: string;
  connectionName?: string;
  /** Display name of the included server model for this feature, null when the user can't use it */
  serverModelName: string | null;
}

/** POST /user/settings/ai/connections */
export interface CreateAIConnectionBody {
  provider: AI_PROVIDER;
  name: string;
  model: string;
  /** Required for `custom`, rejected for native providers */
  baseUrl?: string;
  apiKey?: string;
  /** Reuse the stored key of another connection of the same provider */
  keyFromConnectionId?: string;
}

/** PUT /user/settings/ai/connections/:id. `apiKey` omitted keeps the key, `null` clears it (`custom` only). */
export interface UpdateAIConnectionBody {
  name?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string | null;
}

/** POST /user/settings/ai/connections/test. With `connectionId`, omitted fields fall back to the stored ones. */
export type TestAIConnectionBody =
  | Omit<CreateAIConnectionBody, 'name'>
  | {
      connectionId: string;
      model?: string;
      baseUrl?: string;
      apiKey?: string;
    };

export type TestAIConnectionResponse = { isValid: true; error?: undefined } | { isValid: false; error: string };

/** POST /user/settings/ai/connections/models. `connectionId` supplies the stored key/baseUrl. */
export interface ListAIConnectionModelsBody {
  provider: AI_PROVIDER;
  baseUrl?: string;
  apiKey?: string;
  connectionId?: string;
}

/** Live model ids, empty when the provider can't be listed */
export interface ListAIConnectionModelsResponse {
  models: string[];
}

/** PUT /user/settings/ai/features/:feature */
export type SetAIFeatureConfigBody = Pick<AIFeatureConfig, 'connectionId'>;

/** Maximum character length for custom AI categorization instructions */
export const AI_CUSTOM_INSTRUCTIONS_MAX_LENGTH = 2000;

export const AI_MODEL_NAME_MAX_LENGTH = 200;

export const AI_CONNECTION_NAME_MAX_LENGTH = 50;

export function getModelNameFromModelId({ modelId }: { modelId: string }): string {
  const parts = modelId.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : modelId;
}
