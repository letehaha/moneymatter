import { AIConnectionInfo, AIFeatureStatus, getModelNameFromModelId } from '@bt/shared/types';

// Connection ids are UUIDs, so these never collide with one.
export const AUTOMATIC_OPTION = 'automatic';
export const SERVER_OPTION = 'server';

export type AutomaticTarget = { kind: 'server' } | { kind: 'connection'; name: string; model: string } | null;

export type FeatureModelOption =
  | { value: typeof AUTOMATIC_OPTION; kind: 'automatic'; target: AutomaticTarget }
  | { value: typeof SERVER_OPTION; kind: 'server' }
  | { value: string; kind: 'connection'; name: string; model: string; needsAttention: boolean };

export const readFeatureSelectValue = ({ status }: { status: AIFeatureStatus }): string => {
  if (!status.isConfigured) return AUTOMATIC_OPTION;
  return status.configuredConnectionId ?? SERVER_OPTION;
};

/** The model that answers. The status carries it whether it is the connection's own or an override. */
export const formatAnsweringModel = ({ status }: { status: AIFeatureStatus }): string =>
  getModelNameFromModelId({ modelId: status.modelId });

/** What "Automatic" resolves to. Only an unconfigured status says: a configured one describes the pick. */
const describeAutomaticTarget = ({ status }: { status: AIFeatureStatus }): AutomaticTarget => {
  if (status.isConfigured) return null;
  if (status.servedBy === 'server') return { kind: 'server' };
  if (status.servedBy !== 'connection' || !status.connectionName) return null;

  return { kind: 'connection', name: status.connectionName, model: formatAnsweringModel({ status }) };
};

export const buildFeatureModelOptions = ({
  status,
  connections,
}: {
  status: AIFeatureStatus;
  connections: AIConnectionInfo[];
}): FeatureModelOption[] => {
  const options: FeatureModelOption[] = [
    { value: AUTOMATIC_OPTION, kind: 'automatic', target: describeAutomaticTarget({ status }) },
  ];

  if (status.serverModelName) options.push({ value: SERVER_OPTION, kind: 'server' });

  for (const connection of connections) {
    options.push({
      value: connection.id,
      kind: 'connection',
      name: connection.name,
      model: connection.model,
      needsAttention: connection.status === 'invalid',
    });
  }

  // The status names the picked connection while the list is still loading or failed to.
  const configuredId = status.isConfigured ? status.configuredConnectionId : null;
  if (configuredId && !connections.some((connection) => connection.id === configuredId)) {
    options.push({
      value: configuredId,
      kind: 'connection',
      name: status.connectionName ?? '',
      model: getModelNameFromModelId({ modelId: status.modelId }),
      needsAttention: false,
    });
  }

  return options;
};
