/**
 * Mock implementation of @better-auth/oauth-provider for Jest tests.
 */

interface OAuthProviderConfig {
  loginPage?: string;
  consentPage?: string;
  scopes?: string[];
  accessTokenExpiresIn?: number;
  refreshTokenExpiresIn?: number;
  allowDynamicClientRegistration?: boolean;
  allowUnauthenticatedClientRegistration?: boolean;
  grantTypes?: string[];
  disableJwtPlugin?: boolean;
  resources?: Array<string | { identifier: string; name?: string }>;
  enforcePerClientResources?: boolean;
  schema?: Record<string, { modelName: string }>;
}

/**
 * Creates an OAuth provider plugin for better-auth.
 * This is a simplified mock that provides the essential API shape.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function oauthProvider(config?: OAuthProviderConfig) {
  return {
    id: 'oauth-provider',
    init: () => ({}),
  };
}
