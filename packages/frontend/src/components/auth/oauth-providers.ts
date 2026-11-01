import { OAUTH_PROVIDER } from '@bt/shared/types';

/** Human-facing display names for OAuth providers, used in buttons and messages. */
export const OAUTH_PROVIDER_NAMES: Record<OAUTH_PROVIDER, string> = {
  [OAUTH_PROVIDER.google]: 'Google',
  [OAUTH_PROVIDER.github]: 'GitHub',
  [OAUTH_PROVIDER.apple]: 'Apple',
};
