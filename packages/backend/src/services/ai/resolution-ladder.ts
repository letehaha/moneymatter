import { AIConnectionStatus, AIFeatureConfig, AI_FEATURE, AI_PROVIDER } from '@bt/shared/types';
import { logger } from '@js/utils/logger';

// The one place that decides which model answers an AI feature. The runtime resolver and
// the settings screens both walk this ladder, so what runs and what the UI names cannot
// drift apart.

type ServerProvider = AI_PROVIDER.google | AI_PROVIDER.anthropic;

let anthropicKeySuspendedUntil = 0;

// ponytail: per-process and retried hourly, so a dead key fails one run per instance per hour.
// Shared store plus a health probe if that matters.
export const suspendAnthropicServerKey = ({ reason }: { reason: string }): void => {
  anthropicKeySuspendedUntil = Date.now() + 60 * 60 * 1000;
  logger.error('Anthropic Plus model suspended: paying Plus users fall back to the shared model for an hour', {
    reason,
  });
};

/**
 * Paying Plus users get their own quota once GEMINI_PLUS_API_KEY is set; everyone else shares
 * GEMINI_API_KEY. Anthropic has no shared key: ANTHROPIC_PLUS_API_KEY serves paying Plus users only.
 */
export const getServerApiKey = ({
  provider = AI_PROVIDER.google,
  paidPlus = false,
}: { provider?: ServerProvider; paidPlus?: boolean } = {}): string | null =>
  provider === AI_PROVIDER.anthropic
    ? (paidPlus && Date.now() >= anthropicKeySuspendedUntil && process.env.ANTHROPIC_PLUS_API_KEY) || null
    : (paidPlus && process.env.GEMINI_PLUS_API_KEY) || process.env.GEMINI_API_KEY || null;

interface ServerModel {
  provider: ServerProvider;
  model: string;
}

/** The included model per feature, served with the operator's key. */
export const SERVER_MODELS: Record<AI_FEATURE, ServerModel & { provider: AI_PROVIDER.google }> = {
  [AI_FEATURE.categorization]: { provider: AI_PROVIDER.google, model: 'gemma-4-31b-it' },
  [AI_FEATURE.statementParsing]: { provider: AI_PROVIDER.google, model: 'gemini-3.8-flash' },
  [AI_FEATURE.investmentTransactionsParsing]: { provider: AI_PROVIDER.google, model: 'gemini-3.8-flash' },
  [AI_FEATURE.receiptParsing]: { provider: AI_PROVIDER.google, model: 'gemini-3.5-flash-lite' },
};

/** Replaces the included model for paying Plus users while a key for its provider is usable. */
export const PLUS_SERVER_MODELS: Partial<Record<AI_FEATURE, ServerModel>> = {
  [AI_FEATURE.categorization]: { provider: AI_PROVIDER.anthropic, model: 'claude-haiku-5-5' },
  [AI_FEATURE.statementParsing]: { provider: AI_PROVIDER.anthropic, model: 'claude-haiku-5-5' },
  [AI_FEATURE.investmentTransactionsParsing]: { provider: AI_PROVIDER.anthropic, model: 'claude-haiku-5-5' },
  [AI_FEATURE.receiptParsing]: { provider: AI_PROVIDER.anthropic, model: 'claude-haiku-5-5' },
};

/** The included model for the feature, or null when the user can't use it or no server key backs it. */
export function getServerModel({
  feature,
  serverKeysAllowed,
  paidPlus,
}: {
  feature: AI_FEATURE;
  serverKeysAllowed: boolean;
  paidPlus: boolean;
}): ServerModel | null {
  if (!serverKeysAllowed) return null;

  const plusModel = PLUS_SERVER_MODELS[feature];
  if (plusModel && getServerApiKey({ provider: plusModel.provider, paidPlus })) return plusModel;

  return getServerApiKey() ? SERVER_MODELS[feature] : null;
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
  paidPlus,
  excludedConnectionIds,
}: {
  feature: AI_FEATURE;
  config: AIFeatureConfig | null;
  /** In saved order: the first dialable one wins. */
  connections: readonly C[];
  /** When false the walk behaves as if no server key existed. */
  serverKeysAllowed: boolean;
  paidPlus: boolean;
  excludedConnectionIds?: ReadonlySet<string>;
}): ResolutionStep<C> {
  const excluded = excludedConnectionIds ?? new Set<string>();
  const serverModel = getServerModel({ feature, serverKeysAllowed, paidPlus });

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
