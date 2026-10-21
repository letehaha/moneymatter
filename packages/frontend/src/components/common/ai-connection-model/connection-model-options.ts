import { type AIConnectionInfo, asAiCliProvider, findCliAiModel } from '@bt/shared/types';

type ModelOwner = Pick<AIConnectionInfo, 'provider' | 'model'>;

/**
 * A subscription model by its curated label: a versioned id as it is, an alias as the moving one it is
 * (`haiku (latest)`). The provider listings carry ids only, so any other model shows as the provider names it.
 */
export const formatConnectionModelName = ({ provider, model }: ModelOwner): string => {
  const cliProvider = asAiCliProvider({ provider });

  return (cliProvider && findCliAiModel({ provider: cliProvider, model })?.label) || model;
};
