import { AIFeatureStatus, AI_FEATURE, AI_PROVIDER } from '@bt/shared/types';
import type { StoredAiSettings } from '@models/user-settings.model';

import { getModelProfile } from '../ai/model-catalog';
import { buildConnectionModelId, getServerModel, pickResolutionStep } from '../ai/resolution-ladder';

async function describeModel(spec: {
  provider: AI_PROVIDER;
  model: string;
  baseUrl?: string;
}): Promise<Pick<AIFeatureStatus, 'modelName' | 'pricing' | 'capabilities'>> {
  const { name, pricing, capabilities } = await getModelProfile(spec);
  return { modelName: name, pricing, capabilities };
}

/**
 * Display-only projection of the same `pickResolutionStep` walk the runtime uses, so the
 * screen cannot name a model the run would not pick — `serverKeysAllowed` therefore has to
 * match what the run gets. A native connection without a key is skipped as the run skips it;
 * an undecryptable stored key surfaces only when the request is made.
 */
export async function resolveFeatureStatus({
  feature,
  aiSettings,
  serverKeysAllowed,
}: {
  feature: AI_FEATURE;
  aiSettings: StoredAiSettings | null;
  serverKeysAllowed: boolean;
}): Promise<AIFeatureStatus> {
  const config = aiSettings?.featureConfigs?.find((candidate) => candidate.feature === feature) ?? null;
  const connections = aiSettings?.connections ?? [];
  const serverModel = getServerModel({ feature, serverKeysAllowed });
  const serverModelName = serverModel ? (await describeModel(serverModel)).modelName : null;
  const step = pickResolutionStep({
    feature,
    config,
    connections,
    serverKeysAllowed,
    excludedConnectionIds: new Set(
      connections
        .filter((connection) => connection.provider !== AI_PROVIDER.custom && !connection.keyEncrypted)
        .map((connection) => connection.id),
    ),
  });

  switch (step.kind) {
    // With every connection down the run refuses rather than move to the server model, so the
    // first connection is still what the screen names.
    case 'configured':
    case 'default-connection':
    case 'all-connections-down': {
      const { connection } = step;
      const modelId = buildConnectionModelId(connection);

      return {
        feature,
        isConfigured: step.kind === 'configured',
        configuredConnectionId: step.kind === 'configured' ? connection.id : undefined,
        servedBy: step.kind === 'all-connections-down' ? null : 'connection',
        modelId,
        ...(await describeModel(connection)),
        usingUserKey: true,
        connectionId: connection.id,
        connectionName: connection.name,
        serverModelName,
      };
    }

    case 'configured-server':
    case 'server-default':
      return {
        feature,
        isConfigured: step.kind === 'configured-server',
        configuredConnectionId: step.kind === 'configured-server' ? null : undefined,
        servedBy: 'server',
        modelId: buildConnectionModelId(step.model),
        ...(await describeModel(step.model)),
        usingUserKey: false,
        serverModelName,
      };

    case 'unserved':
      return {
        feature,
        isConfigured: false,
        servedBy: null,
        modelId: '',
        modelName: '',
        pricing: null,
        capabilities: null,
        usingUserKey: false,
        serverModelName,
      };
  }
}
