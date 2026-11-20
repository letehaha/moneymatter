import { MCP_TOOLSET_SCOPES } from '@bt/shared/types';

/**
 * Scopes advertised to MCP clients as `scopes_supported`. Clients request all of them and the user
 * narrows them down on the consent screen: `finance:write` / `finance:delete` gate the mutation
 * tools, and each `toolset:<id>` adds that toolset's tools to `core`.
 *
 * The static mirrors and the server card under packages/frontend/public/.well-known are generated
 * from it by `npm run mcp:generate-metadata`.
 */
export const MCP_SCOPES_SUPPORTED: readonly string[] = [
  'finance:read',
  'finance:write',
  'finance:delete',
  'profile:read',
  'offline_access',
  ...MCP_TOOLSET_SCOPES,
];

/**
 * Scopes the OAuth provider accepts. 'claudeai' is a no-op scope required as a workaround: Claude.ai
 * adds it to client registration requests and better-auth rejects unknown scopes with 400.
 * See: https://github.com/anthropics/claude-ai-mcp/issues/111
 */
export const OAUTH_PROVIDER_SCOPES: readonly string[] = [...MCP_SCOPES_SUPPORTED, 'claudeai'];
