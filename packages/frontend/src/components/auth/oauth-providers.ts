import { OAUTH_PROVIDER } from '@bt/shared/types';

/** Human-facing display names for OAuth providers, used in buttons and messages. */
const OAUTH_PROVIDER_NAMES: Record<OAUTH_PROVIDER, string> = {
  [OAUTH_PROVIDER.google]: 'Google',
  [OAUTH_PROVIDER.github]: 'GitHub',
  [OAUTH_PROVIDER.oidc]: 'SSO',
};

/** Display name for a provider. The OIDC provider is named by the server (`OIDC_PROVIDER_NAME`). */
export const getOAuthProviderName = ({
  provider,
  oidcName,
}: {
  provider: OAUTH_PROVIDER;
  oidcName?: string | null;
}): string => (provider === OAUTH_PROVIDER.oidc && oidcName ? oidcName : OAUTH_PROVIDER_NAMES[provider]);
