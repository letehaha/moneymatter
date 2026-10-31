import { EnvVar, isEnvConfigured } from '@common/utils/env';

// Shown on the sign-in button when OIDC_PROVIDER_NAME is unset.
const DEFAULT_OIDC_PROVIDER_NAME = 'SSO';

interface OidcConfig {
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
  displayName: string;
}

const getOidcConfig = (): OidcConfig | null => {
  const { OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_PROVIDER_NAME } = process.env;

  if (
    !isEnvConfigured(EnvVar.OIDC_ISSUER, OIDC_ISSUER) ||
    !isEnvConfigured(EnvVar.OIDC_CLIENT_ID, OIDC_CLIENT_ID) ||
    !isEnvConfigured(EnvVar.OIDC_CLIENT_SECRET, OIDC_CLIENT_SECRET)
  ) {
    return null;
  }

  return {
    discoveryUrl: `${OIDC_ISSUER!.replace(/\/+$/, '')}/.well-known/openid-configuration`,
    clientId: OIDC_CLIENT_ID!,
    clientSecret: OIDC_CLIENT_SECRET!,
    displayName: OIDC_PROVIDER_NAME?.trim() || DEFAULT_OIDC_PROVIDER_NAME,
  };
};

/**
 * Generic OpenID Connect sign-in for self-hosters who run their own identity provider.
 * Enabled only when issuer, client id and client secret are all set; null otherwise.
 */
export const oidcConfig = getOidcConfig();
