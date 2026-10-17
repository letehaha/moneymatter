import { AIConnectionStatus, AIFeatureConfig, AI_FEATURE, AI_PROVIDER } from '@bt/shared/types';
import { logger } from '@js/utils/logger';

// The one place that decides which model answers an AI feature. The runtime resolver and
// the settings screens both walk this ladder, so what runs and what the UI names cannot
// drift apart.

type ServerProvider = AI_PROVIDER.google | AI_PROVIDER.anthropic;

export interface ServerModel {
  provider: ServerProvider;
  model: string;
}

/** What every server-served AI call uses while its key works. Swapping providers starts here. */
export const PRIMARY_SERVER_MODEL = {
  provider: AI_PROVIDER.anthropic,
  model: 'claude-haiku-5-5',
} as const satisfies ServerModel;

let primaryKeySuspendedUntil = 0;

// ponytail: per-process and retried hourly, so a dead key fails one run per instance per hour.
// Shared store plus a health probe if that matters.
export const suspendPrimaryServerKey = ({ reason }: { reason: string }): void => {
  primaryKeySuspendedUntil = Date.now() + 60 * 60 * 1000;
  logger.error('Primary server model suspended: server-served features fall back to Gemini for an hour', {
    reason,
  });
};

const SERVER_API_KEY_ENV_VARS: Record<ServerProvider, string> = {
  [AI_PROVIDER.anthropic]: 'ANTHROPIC_API_KEY',
  [AI_PROVIDER.google]: 'GEMINI_API_KEY',
};

export const getServerApiKey = ({ provider = AI_PROVIDER.google }: { provider?: ServerProvider } = {}):
  | string
  | null => {
  if (provider === PRIMARY_SERVER_MODEL.provider && Date.now() < primaryKeySuspendedUntil) return null;

  return process.env[SERVER_API_KEY_ENV_VARS[provider]] || null;
};

/** The Gemini model per feature, used while the primary model has no usable key. */
export const FALLBACK_SERVER_MODELS: Record<AI_FEATURE, ServerModel & { provider: AI_PROVIDER.google }> = {
  [AI_FEATURE.categorization]: { provider: AI_PROVIDER.google, model: 'gemma-4-31b-it' },
  [AI_FEATURE.statementParsing]: { provider: AI_PROVIDER.google, model: 'gemini-3.8-flash' },
  [AI_FEATURE.investmentTransactionsParsing]: { provider: AI_PROVIDER.google, model: 'gemini-3.8-flash' },
  [AI_FEATURE.receiptParsing]: { provider: AI_PROVIDER.google, model: 'gemini-3.5-flash-lite' },
};

/**
 * The included model for the feature, or null when the user can't use it or no server key backs it.
 * Callers fold the AI allowance into `serverKeysAllowed`.
 */
export function getServerModel({
  feature,
  serverKeysAllowed,
}: {
  feature: AI_FEATURE;
  serverKeysAllowed: boolean;
}): ServerModel | null {
  if (!serverKeysAllowed) return null;
  if (getServerApiKey({ provider: PRIMARY_SERVER_MODEL.provider })) return PRIMARY_SERVER_MODEL;

  return getServerApiKey() ? FALLBACK_SERVER_MODELS[feature] : null;
}

/** `provider/model`, e.g. `anthropic/claude-sonnet-5` or `custom/llama3.2`. */
export function buildConnectionModelId({ provider, model }: { provider: AI_PROVIDER; model: string }): string {
  return `${provider}/${model}`;
}

export interface LadderConnection {
  id: string;
  status: AIConnectionStatus;
}

type ResolutionStep<C extends LadderConnection> =
  /** An explicit pick is dialled even while flagged invalid, so a recovered connection heals itself on the next run. */
  | { kind: 'configured'; connection: C }
  | { kind: 'configured-server'; model: ServerModel }
  /** No usable config: the first connection not flagged invalid answers. */
  | { kind: 'default-connection'; connection: C }
  /** The user owns connections and every one is down. The run refuses instead of moving their
   * data to the server model they never picked. */
  | { kind: 'all-connections-down'; connection: C }
  | { kind: 'server-default'; model: ServerModel }
  | { kind: 'unserved' };

/**
 * Priority order: explicit feature config, then the user's first dialable connection, then
 * the included server model, but only for a user who owns no connections at all. Pure over
 * its inputs plus the server-key env vars and the Anthropic key suspension.
 *
 * A config pointing at a deleted connection, or a server pick the user can no longer use,
 * falls through as if unset. Pass `excludedConnectionIds` to re-run the walk with a
 * connection ruled out.
 */
export function pickResolutionStep<C extends LadderConnection>({
  feature,
  config,
  connections,
  serverKeysAllowed,
  excludedConnectionIds,
}: {
  feature: AI_FEATURE;
  config: AIFeatureConfig | null;
  /** In saved order: the first dialable one wins. */
  connections: readonly C[];
  /** When false the walk behaves as if no server key existed. */
  serverKeysAllowed: boolean;
  excludedConnectionIds?: ReadonlySet<string>;
}): ResolutionStep<C> {
  const excluded = excludedConnectionIds ?? new Set<string>();
  const serverModel = getServerModel({ feature, serverKeysAllowed });

  if (config) {
    if (config.connectionId === null) {
      if (serverModel) return { kind: 'configured-server', model: serverModel };
    } else {
      const connection = connections.find(
        (candidate) => candidate.id === config.connectionId && !excluded.has(candidate.id),
      );
      if (connection) return { kind: 'configured', connection };
    }
  }

  const dialable = connections.find((candidate) => candidate.status !== 'invalid' && !excluded.has(candidate.id));
  if (dialable) return { kind: 'default-connection', connection: dialable };
  if (connections.length > 0) return { kind: 'all-connections-down', connection: connections[0]! };

  if (serverModel) return { kind: 'server-default', model: serverModel };

  return { kind: 'unserved' };
}
