import { api, API_HTTP } from '@/api/_api';
import { config } from '@/common/config';
import type { GetMcpToolsetsResponse } from '@bt/shared/types';

interface ConnectedApp {
  clientId: string;
  name: string | null;
  icon: string | null;
  scopes: string[];
  connectedAt: string;
  lastUsedAt: string | null;
}

export const getConnectedApps = async (): Promise<ConnectedApp[]> => {
  return api.get('/user/settings/mcp/connected-apps');
};

export const revokeConnectedApp = async ({ clientId }: { clientId: string }): Promise<{ success: boolean }> => {
  return api.delete(`/user/settings/mcp/connected-apps/${clientId}`);
};

/** Each MCP toolset with its OAuth scope and tool count, `core` first. */
export const getMcpToolsets = async (): Promise<GetMcpToolsetsResponse> => {
  return api.get('/user/settings/mcp/toolsets');
};

export const getOAuthClientName = async ({ clientId }: { clientId: string }): Promise<{ name: string | null }> => {
  return api.get(`/auth/oauth2/client-info?client_id=${encodeURIComponent(clientId)}`);
};

export function getMcpServerUrl(): string {
  if (config.mcpBaseUrl) {
    return `${config.mcpBaseUrl}/mcp`;
  }
  // This URL is displayed and copied into external MCP clients, so it must be
  // absolute. API_HTTP is '' in same-origin mode, so fall back to the page
  // origin (better-auth's getBaseURL does the same for the same reason).
  // NOTE: in a same-origin self-host the frontend nginx only reverse-proxies
  // /api/, not /mcp — so this origin URL resolves but 404s to the SPA unless
  // MCP_BASE_URL points at a publicly reachable backend origin.
  return `${API_HTTP || window.location.origin}/mcp`;
}

/**
 * Raw `fetch` is used intentionally here instead of the `api` client because
 * the OAuth consent flow needs access to the raw `Response` object to detect
 * HTTP redirects (`response.redirected`, `response.url`) and to read the
 * response body conditionally. The `api` client unwraps responses automatically
 * and doesn't expose the raw `Response`.
 */
export async function submitOAuthConsent({
  accept,
  oauthQuery,
  scope,
}: {
  accept: boolean;
  oauthQuery: string;
  scope?: string;
}): Promise<Response> {
  const body: { accept: boolean; oauth_query: string; scope?: string } = {
    accept,
    oauth_query: oauthQuery,
  };
  if (scope !== undefined) body.scope = scope;

  return fetch(`${API_HTTP}/api/v1/auth/oauth2/consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
}

export function getOAuthAuthorizeUrl({ queryParams }: { queryParams: Record<string, string> }): string {
  const params = new URLSearchParams(queryParams);
  return `${API_HTTP}/api/v1/auth/oauth2/authorize?${params.toString()}`;
}
