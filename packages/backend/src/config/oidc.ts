import { EnvVar, isEnvConfigured } from '@common/utils/env';
import { logger } from '@js/utils/logger';

// Shown on the sign-in button when OIDC_PROVIDER_NAME is unset.
const DEFAULT_OIDC_PROVIDER_NAME = 'SSO';
const DISCOVERY_PATH = '/.well-known/openid-configuration';
const REQUIRED_VARS = [EnvVar.OIDC_ISSUER, EnvVar.OIDC_CLIENT_ID, EnvVar.OIDC_CLIENT_SECRET];

interface OidcConfig {
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
  displayName: string;
  trustEmail: boolean;
}

const isValidIssuer = ({ issuer }: { issuer: string }): boolean => {
  try {
    const { protocol } = new URL(issuer);
    return (protocol === 'http:' || protocol === 'https:') && !issuer.endsWith(DISCOVERY_PATH);
  } catch {
    return false;
  }
};

export const getOidcConfig = ({ env }: { env: Partial<NodeJS.ProcessEnv> }): OidcConfig | null => {
  const missing = REQUIRED_VARS.filter((name) => !isEnvConfigured(name, env[name]));

  if (missing.length === REQUIRED_VARS.length) return null;

  if (missing.length > 0) {
    logger.warn(`[oidc] OIDC sign-in disabled: ${missing.join(', ')} not set.`);
    return null;
  }

  const issuer = env.OIDC_ISSUER!.replace(/\/+$/, '');

  if (!isValidIssuer({ issuer })) {
    logger.warn(`[oidc] OIDC sign-in disabled: OIDC_ISSUER must be an http(s) URL without ${DISCOVERY_PATH}.`);
    return null;
  }

  return {
    discoveryUrl: `${issuer}${DISCOVERY_PATH}`,
    clientId: env.OIDC_CLIENT_ID!,
    clientSecret: env.OIDC_CLIENT_SECRET!,
    displayName: env.OIDC_PROVIDER_NAME?.trim() || DEFAULT_OIDC_PROVIDER_NAME,
    trustEmail: env.OIDC_TRUST_EMAIL === 'true',
  };
};

/**
 * Generic OpenID Connect sign-in for self-hosters who run their own identity provider.
 * Enabled only when issuer, client id and client secret are all set; null otherwise.
 */
export const oidcConfig = getOidcConfig({ env: process.env });
