import { AIFeatureConfig, AINativeProvider, AI_FEATURE, AI_PROVIDER, hasServerAiEntitlement } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import type { StoredConnection } from '@models/user-settings.model';

import { getEntitlementsByUserId } from '../entitlements/resolve-entitlements.service';
import { decryptConnectionKey, getStoredAiSettings, markConnectionInvalid } from '../user-settings/ai-connections';
import { isWithinAiAllowance } from './ai-allowance';
import type { ProviderModelSpec } from './ai-client-factory';
import { CONNECTION_KEY_UNREADABLE_ERROR_MESSAGE } from './connection-failure';
import {
  buildConnectionModelId,
  findStoredFeatureConfig,
  getServerApiKey,
  pickResolutionStep,
} from './resolution-ladder';

type AIConfigResolution =
  | (ProviderModelSpec & {
      kind: 'connection';
      modelId: string;
      connectionId: string;
      usingUserKey: true;
      /** The run uses a model picked for the feature or thread, not the connection's own */
      modelOverridden?: true;
    })
  | { kind: 'server'; provider: AINativeProvider; model: string; modelId: string; apiKey: string; usingUserKey: false };

/**
 * Null when the connection can't be dialled as stored: a key that no longer decrypts would go
 * out keyless and blame a key the user never touched, and a native provider has no keyless mode.
 */
function toProviderModelSpec({
  connection: stored,
  model,
  apiKey,
}: {
  connection: StoredConnection;
  /** The model to dial: the connection's own, or the override picked for the feature or thread. */
  model: string;
  apiKey: string | null;
}): ProviderModelSpec | null {
  const connection = { ...stored, model };

  if (connection.keyEncrypted && apiKey === null) return null;

  if (connection.provider !== AI_PROVIDER.custom) {
    return apiKey ? { provider: connection.provider, model: connection.model, apiKey } : null;
  }

  return connection.baseUrl
    ? { provider: AI_PROVIDER.custom, model: connection.model, apiKey, baseUrl: connection.baseUrl }
    : null;
}

/**
 * Materializes the credentials for the picked resolution step. A connection that can't be
 * dialled is flagged, excluded and the walk re-runs, so one broken secret never dead-ends a
 * step another connection could serve.
 *
 * Returns null when nothing can answer, and also when the user owns connections and all of
 * them are down, even with a server key available.
 */
export async function resolveAIConfiguration({
  userId,
  feature,
  allowOperatorKey = false,
  pinnedConnectionId,
  pinnedModelId,
}: {
  userId: number;
  feature: AI_FEATURE;
  /** Grants the server key for this one call, for a feature the caller gates itself. */
  allowOperatorKey?: boolean;
  /**
   * Stands in for the stored feature config: a connection id, or null for the included server model.
   * Omitted, the stored config applies (chat has none: its threads carry the pick).
   */
  pinnedConnectionId?: string | null;
  /** With a pinned connection: a model of that connection's provider to run instead of its own. */
  pinnedModelId?: string | null;
}): Promise<AIConfigResolution | null> {
  const aiSettings = await getStoredAiSettings({ userId });
  const connections = aiSettings?.connections ?? [];
  const config: AIFeatureConfig | null =
    pinnedConnectionId === undefined
      ? findStoredFeatureConfig({ aiSettings, feature })
      : { feature, connectionId: pinnedConnectionId, ...(pinnedModelId ? { modelId: pinnedModelId } : {}) };
  const entitlements = await getEntitlementsByUserId({ userId });
  const entitled = allowOperatorKey || hasServerAiEntitlement({ entitlements, feature });
  const withinAllowance = entitled ? await isWithinAiAllowance({ userId, entitlements }) : undefined;
  const serverKeysAllowed = withinAllowance === true;
  const excludedConnectionIds = new Set<string>();

  // Every pass either returns or excludes one more connection, so the walk ends.
  for (let pass = 0; pass <= connections.length; pass++) {
    const step = pickResolutionStep({
      feature,
      config,
      connections,
      serverKeysAllowed,
      excludedConnectionIds,
    });

    if (pass === 0 && config && step.kind !== 'configured' && step.kind !== 'configured-server') {
      // Reachable by deleting the connection or losing the plan the config relies on: user state, not a bug.
      logger.info('Stored AI feature config cannot answer, falling back', {
        userId,
        feature,
        connectionId: config.connectionId,
      });
    }

    switch (step.kind) {
      case 'configured':
      case 'default-connection': {
        const { connection } = step;

        // Only the picked connection takes the override. A walk that landed on another one runs its own model.
        const model = (step.kind === 'configured' && step.modelId) || connection.model;
        const spec = toProviderModelSpec({
          connection,
          model,
          apiKey: decryptConnectionKey({ connection, userId }),
        });

        if (!spec) {
          // An already-flagged connection keeps its message, which may be more specific than this one.
          if (connection.status !== 'invalid') {
            await markConnectionInvalid({
              userId,
              connectionId: connection.id,
              errorMessage: CONNECTION_KEY_UNREADABLE_ERROR_MESSAGE,
            });
          }
          excludedConnectionIds.add(connection.id);
          continue;
        }

        return {
          ...spec,
          kind: 'connection',
          modelId: buildConnectionModelId({ provider: connection.provider, model }),
          connectionId: connection.id,
          usingUserKey: true,
          ...(model === connection.model ? {} : { modelOverridden: true as const }),
        };
      }

      case 'configured-server':
      case 'server-default': {
        const apiKey = getServerApiKey({ provider: step.model.provider });
        if (!apiKey) {
          logger.error('Server AI key vanished between pick and use', { feature, provider: step.model.provider });
          return null;
        }

        return {
          kind: 'server',
          ...step.model,
          modelId: buildConnectionModelId(step.model),
          apiKey,
          usingUserKey: false,
        };
      }

      case 'all-connections-down':
        // Serving from the server key would send the user's data to a provider they never chose.
        logger.info('Every AI connection is flagged invalid, leaving the feature unserved', { userId, feature });
        return null;

      case 'unserved':
        logger.info('No AI model available for feature', { userId, feature, entitled, withinAllowance });
        return null;
    }
  }

  logger.error('AI configuration resolution did not settle', { userId, feature });
  return null;
}
