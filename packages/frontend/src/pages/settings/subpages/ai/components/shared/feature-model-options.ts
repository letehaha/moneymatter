import { formatConnectionModelName } from '@/components/common/ai-connection-model/connection-model-options';
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

/**
 * The model that answers, as the connection labels it. The status carries it whether it is the
 * connection's own or an override; the provider comes from the connection list when it has loaded.
 */
export const formatAnsweringModel = ({
  status,
  connections,
}: {
  status: AIFeatureStatus;
  connections: AIConnectionInfo[];
}): string => {
  const model = getModelNameFromModelId({ modelId: status.modelId });
  const connection = connections.find(({ id }) => id === status.connectionId);

  return connection ? formatConnectionModelName({ provider: connection.provider, model }) : model;
};

/** What "Automatic" resolves to. Only an unconfigured status says: a configured one describes the pick. */
const describeAutomaticTarget = ({
  status,
  connections,
}: {
  status: AIFeatureStatus;
  connections: AIConnectionInfo[];
}): AutomaticTarget => {
  if (status.isConfigured) return null;
  if (status.servedBy === 'server') return { kind: 'server' };
  if (status.servedBy !== 'connection' || !status.connectionName) return null;

  return { kind: 'connection', name: status.connectionName, model: formatAnsweringModel({ status, connections }) };
};

export const buildFeatureModelOptions = ({
  status,
  connections,
}: {
  status: AIFeatureStatus;
  connections: AIConnectionInfo[];
}): FeatureModelOption[] => {
  const options: FeatureModelOption[] = [
    { value: AUTOMATIC_OPTION, kind: 'automatic', target: describeAutomaticTarget({ status, connections }) },
  ];

  if (status.serverModelName) options.push({ value: SERVER_OPTION, kind: 'server' });

  for (const connection of connections) {
    options.push({
      value: connection.id,
      kind: 'connection',
      name: connection.name,
      model: formatConnectionModelName({ provider: connection.provider, model: connection.model }),
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

type CostDisplay = { kind: 'subscription' } | { kind: 'price'; price: string };

/**
 * The cost line of a feature's model card. A subscription connection has no per-token price, so it says
 * the plan covers it; a priced model needs both its price and a unit to price it in.
 */
export const resolveCostDisplay = ({
  status,
  formattedPrice,
  hasUnitLabel,
}: {
  status: Pick<AIFeatureStatus, 'servedBy' | 'billing'>;
  formattedPrice: string | null;
  hasUnitLabel: boolean;
}): CostDisplay | null => {
  if (status.servedBy !== 'connection') return null;
  if (status.billing === 'subscription') return { kind: 'subscription' };
  if (formattedPrice && hasUnitLabel) return { kind: 'price', price: formattedPrice };
  return null;
};
