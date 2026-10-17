import type { Equals, Expect } from '../type-testing';

/**
 * Supported AI providers for features like transaction categorization.
 *
 * `custom` is any OpenAI-compatible endpoint (OpenRouter, Ollama, a proxy).
 * `claudeCode` and `codex` run the vendor CLI on the owner's subscription instead of an API key.
 */
export enum AI_PROVIDER {
  anthropic = 'anthropic',
  openai = 'openai',
  google = 'google',
  custom = 'custom',
  claudeCode = 'claude-code',
  codex = 'codex',
}

/**
 * AI-powered features that can have individual model configurations
 */
export enum AI_FEATURE {
  categorization = 'categorization',
  statementParsing = 'statement_parsing',
  investmentTransactionsParsing = 'investment_transactions_parsing',
  receiptParsing = 'receipt_parsing',
  trackerMatching = 'tracker_matching',
  transferMatching = 'transfer_matching',
  // Future features:
  // insights = 'insights',
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

/** Providers that run a vendor CLI signed in with a subscription; no API key, no base URL. */
export type AICliProvider = AI_PROVIDER.claudeCode | AI_PROVIDER.codex;

export const AI_CLI_PROVIDERS = [AI_PROVIDER.claudeCode, AI_PROVIDER.codex] as const satisfies readonly AICliProvider[];

/** The provider itself when it is a CLI provider, else undefined. Narrows where a boolean guard can't (object params). */
export function asAiCliProvider({ provider }: { provider: AI_PROVIDER }): AICliProvider | undefined {
  return AI_CLI_PROVIDERS.find((candidate) => candidate === provider);
}

export function isAiCliProvider({ provider }: { provider: AI_PROVIDER }): boolean {
  return asAiCliProvider({ provider }) !== undefined;
}

/** Pins `AI_CLI_PROVIDERS` to list every CLI provider. Exported only so the assertion isn't flagged as unused. */
export type AiCliProvidersAreExhaustive = Expect<Equals<(typeof AI_CLI_PROVIDERS)[number], AICliProvider>>;

/** Providers served through their native SDK at the official API; need an API key, take no base URL. */
export type AINativeProvider = Exclude<AI_PROVIDER, AI_PROVIDER.custom | AICliProvider>;

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

export interface CliAiModel {
  /** Passed to the CLI verbatim as `--model` */
  id: string;
  /** Name shown in the model picker */
  label: string;
  /** Public catalog model (without the provider prefix) used for capability lookup and price */
  catalogId: string;
  isDefault?: boolean;
  /**
   * Ids saved before this entry took its current `id` (the pinned id an alias replaced). The CLI still
   * accepts them, so a stored connection keeps working; the picker shows it as this entry.
   */
  legacyIds?: string[];
}

/**
 * Curated models per CLI provider, one entry per model. Neither CLI can list models without a
 * signed-in session, so the picker offers this list; the create/test probe confirms the pick.
 * Claude entries use the CLI aliases (`sonnet`), which follow the newest model of their family, so a
 * CLI bump needs no change here; `catalogId` only drives capability and price display.
 */
export const CLI_AI_MODELS: Record<AICliProvider, CliAiModel[]> = {
  [AI_PROVIDER.claudeCode]: [
    {
      id: 'sonnet',
      label: 'Claude Sonnet 5.5',
      catalogId: 'claude-sonnet-5-5',
      isDefault: true,
      legacyIds: ['claude-sonnet-5-5'],
    },
    { id: 'opus', label: 'Claude Opus 5.5', catalogId: 'claude-opus-5-5', legacyIds: ['claude-opus-5-5'] },
    { id: 'haiku', label: 'Claude Haiku 5.5', catalogId: 'claude-haiku-5-5', legacyIds: ['claude-haiku-5-5'] },
    { id: 'fable', label: 'Claude Fable 5.1', catalogId: 'claude-fable-5-1', legacyIds: ['claude-fable-5-1'] },
  ],
  [AI_PROVIDER.codex]: [
    { id: 'gpt-6-astra', label: 'GPT-6 Astra', catalogId: 'gpt-6-astra', isDefault: true },
    { id: 'gpt-6-sol', label: 'GPT-6 Sol', catalogId: 'gpt-6-sol' },
    { id: 'gpt-6-luna', label: 'GPT-6 Luna', catalogId: 'gpt-6-luna' },
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', catalogId: 'gpt-5.6-sol' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', catalogId: 'gpt-5.6-terra' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', catalogId: 'gpt-5.6-luna' },
    { id: 'gpt-5.5', label: 'GPT-5.5', catalogId: 'gpt-5.5' },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', catalogId: 'gpt-5.3-codex' },
  ],
};

/** The curated entry a stored model id belongs to, whether it is the current id or a legacy one. */
export function findCliAiModel({
  provider,
  model,
}: {
  provider: AICliProvider;
  model: string;
}): CliAiModel | undefined {
  return CLI_AI_MODELS[provider].find((candidate) => candidate.id === model || candidate.legacyIds?.includes(model));
}

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
  /** CLI providers only: when the stored sign-in token stops working (ISO datetime) */
  credentialExpiresAt?: string;
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
  /** `subscription` when the answering connection runs a CLI on the owner's plan: no per-token price */
  billing: 'per-token' | 'subscription';
  /** The answering connection; the first connection when all of them are down */
  connectionId?: string;
  connectionName?: string;
  /** Display name of the included server model for this feature, null when the user can't use it */
  serverModelName: string | null;
}

/** This month's spend on the server AI keys, against the user's included allowance. */
export interface AIAllowance {
  usedPercent: number;
  /** `warning` from 60%; `reached` leaves server-served features unserved until the reset. */
  state: 'ok' | 'warning' | 'reached';
  /** ISO timestamp the allowance resets at, the start of the next UTC month */
  resetsAt: string;
  /** `trial` covers everyone without paid Plus: trials, early adopters and free users */
  plan: 'plus' | 'trial';
}

/** GET /user/settings/ai/features */
export interface AIFeaturesStatusResponse {
  features: AIFeatureStatus[];
  aiAllowance: AIAllowance | null;
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
  /** CLI providers: the finished sign-in session whose credential this connection stores */
  cliAuthSessionId?: string;
}

/** PUT /user/settings/ai/connections/:id. `apiKey` omitted keeps the key, `null` clears it (`custom` only). */
export interface UpdateAIConnectionBody {
  name?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string | null;
  /** CLI providers: re-authenticate with a finished sign-in session of the same provider */
  cliAuthSessionId?: string;
}

/** POST /user/settings/ai/connections/test. With `connectionId`, omitted fields fall back to the stored ones. */
export type TestAIConnectionBody =
  | Omit<CreateAIConnectionBody, 'name'>
  | {
      connectionId: string;
      model?: string;
      baseUrl?: string;
      apiKey?: string;
      cliAuthSessionId?: string;
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

export type CliAuthSessionStatus = 'starting' | 'awaiting-user' | 'verifying' | 'succeeded' | 'failed' | 'expired';

/** In-progress CLI sign-in, polled by the frontend. Never carries the credential. */
export interface CliAuthSessionInfo {
  id: string;
  provider: AICliProvider;
  status: CliAuthSessionStatus;
  /** The login page the user opens */
  authUrl?: string;
  /** Codex device-auth code the user types on the login page */
  userCode?: string;
  expiresAt: string;
  error?: string;
}

export type CliAiUnavailableReason = 'not-self-host' | 'not-admin' | 'admin-not-configured';

/** GET /user/settings/ai/cli/availability */
export interface CliAiAvailability {
  available: boolean;
  /** Set when `available` is false */
  reason?: CliAiUnavailableReason;
  providers: { provider: AICliProvider; installed: boolean; version: string | null }[];
}

/** Maximum character length for custom AI categorization instructions */
export const AI_CUSTOM_INSTRUCTIONS_MAX_LENGTH = 2000;

export const AI_MODEL_NAME_MAX_LENGTH = 200;

export const AI_CONNECTION_NAME_MAX_LENGTH = 50;

export function getModelNameFromModelId({ modelId }: { modelId: string }): string {
  const parts = modelId.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : modelId;
}
