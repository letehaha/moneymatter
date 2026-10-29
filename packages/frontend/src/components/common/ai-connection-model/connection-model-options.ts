import type { AIConnectionInfo } from '@bt/shared/types';

/** Model ids are free text, so this is chosen not to be one a provider would serve. */
export const CONNECTION_DEFAULT_MODEL_VALUE = '__connection-default__';

type ModelOwner = Pick<AIConnectionInfo, 'model'>;

export type ConnectionModelOption =
  | { value: typeof CONNECTION_DEFAULT_MODEL_VALUE; kind: 'default'; model: string; name: string }
  | { value: string; kind: 'model'; model: string; name: string };

/**
 * What a model picker offers for one connection: "Default" first (the connection's own model), then every
 * other model its provider serves. The stored override is kept even when the provider no longer lists it,
 * so the select still shows what the feature is set to.
 */
export const buildConnectionModelOptions = ({
  connection,
  liveModels,
  selectedModelId,
}: {
  connection: ModelOwner;
  liveModels: string[];
  selectedModelId: string | null;
}): ConnectionModelOption[] => {
  const others = [...new Set([...liveModels, ...(selectedModelId ? [selectedModelId] : [])])].filter(
    (model) => model !== connection.model,
  );

  return [
    {
      value: CONNECTION_DEFAULT_MODEL_VALUE,
      kind: 'default',
      model: connection.model,
      name: connection.model,
    },
    ...others.map((model): ConnectionModelOption => ({ value: model, kind: 'model', model, name: model })),
  ];
};

/** The option a stored model id selects: null is the default, an id nothing offers selects nothing. */
export const findSelectedConnectionModelOption = ({
  options,
  modelId,
}: {
  options: ConnectionModelOption[];
  modelId: string | null;
}): ConnectionModelOption | null =>
  modelId === null
    ? (options.find((option) => option.kind === 'default') ?? null)
    : (options.find((option) => option.kind === 'model' && option.value === modelId) ?? null);
