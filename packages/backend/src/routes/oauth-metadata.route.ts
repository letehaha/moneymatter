import { MCP_SCOPES_SUPPORTED } from '@services/mcp/oauth-scopes';
import { Express, Request, Response } from 'express';

import { API_PREFIX, BETTER_AUTH_BASE_URL, MCP_BASE_URL } from '../config';

/**
 * Set up OAuth discovery and metadata routes required by MCP clients.
 *
 * These are mounted at root-level well-known paths (RFC 9728, RFC 8414)
 * and cannot live under a prefixed Router.
 *
 * Keep in sync with the static mirrors served on the landing domain:
 *   - packages/frontend/public/.well-known/oauth-authorization-server
 *   - packages/frontend/public/.well-known/oauth-protected-resource
 * Any change to issuer, endpoints, or scopes here must be reflected there.
 * Those mirrors are only reached in split-domain deployments; a same-origin
 * frontend container proxies these paths here instead (see the oauth-mcp.conf
 * block in self-hosting/frontend/docker-entrypoint.sh).
 */
export function setupOAuthMetadataRoutes({ app }: { app: Express }) {
  // better-auth stamps `${BETTER_AUTH_URL}${API_PREFIX}/auth` as the RFC 9207 `iss` on
  // authorization responses; clients abort on a mismatch, so discovery must advertise
  // that exact string (MCP_BASE_URL can be a different host in split-domain deployments).
  const issuer = `${BETTER_AUTH_BASE_URL}${API_PREFIX}/auth`;

  // OAuth Protected Resource Metadata (RFC 9728)
  // MCP clients discover the authorization server via this endpoint.
  // Claude.ai fetches the path-aware form first, then falls back to root.
  const protectedResourceHandler = (_req: Request, res: Response) => {
    res.json({
      resource: `${MCP_BASE_URL}/mcp`,
      authorization_servers: [issuer],
      scopes_supported: MCP_SCOPES_SUPPORTED,
      bearer_methods_supported: ['header'],
    });
  };

  // Path-aware form (RFC 9728 Section 3.1) — Claude.ai tries this first
  app.get('/.well-known/oauth-protected-resource/mcp', protectedResourceHandler);
  // Root form — fallback
  app.get('/.well-known/oauth-protected-resource', protectedResourceHandler);

  // OAuth Authorization Server Metadata (RFC 8414)
  const asMetadataHandler = (_req: Request, res: Response) => {
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/oauth2/authorize`,
      token_endpoint: `${issuer}/oauth2/token`,
      registration_endpoint: `${issuer}/oauth2/register`,
      revocation_endpoint: `${issuer}/oauth2/revoke`,
      introspection_endpoint: `${issuer}/oauth2/introspect`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: MCP_SCOPES_SUPPORTED,
    });
  };

  // RFC 8414 3.1 form for an issuer with a path: the well-known segment is inserted
  // after the host, so the issuer's path follows it.
  app.get(`/.well-known/oauth-authorization-server${API_PREFIX}/auth`, asMetadataHandler);
  // `/mcp` and root forms kept for clients (incl. Claude.ai) that request them.
  app.get('/.well-known/oauth-authorization-server/mcp', asMetadataHandler);
  app.get('/.well-known/oauth-authorization-server', asMetadataHandler);

  // Claude.ai workaround: it ignores authorization_endpoint/token_endpoint from the
  // AS metadata and hardcodes /authorize, /token, /register on the base URL.
  // 307 redirects preserve the HTTP method (POST stays POST).
  // See: https://github.com/anthropics/claude-ai-mcp/issues/82
  const oauthProxyPaths: Record<string, string> = {
    '/authorize': `${API_PREFIX}/auth/oauth2/authorize`,
    '/token': `${API_PREFIX}/auth/oauth2/token`,
    '/register': `${API_PREFIX}/auth/oauth2/register`,
  };

  for (const [shortPath, fullPath] of Object.entries(oauthProxyPaths)) {
    app.all(shortPath, (req, res) => {
      const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
      res.redirect(307, `${fullPath}${qs}`);
    });
  }
}
