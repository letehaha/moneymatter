import { describe, expect, it } from '@jest/globals';
import * as mcpHelpers from '@tests/helpers/mcp';

// Cloudflare Access adds this cookie to every request it forwards to the origin.
const CLOUDFLARE_ACCESS_HEADERS = { Cookie: 'CF_Authorization=dummy' };

const publicClientBody = {
  client_name: 'Cloudflare Access MCP client',
  redirect_uris: ['http://localhost:34567/callback'],
  token_endpoint_auth_method: 'none',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
};

describe('POST /auth/oauth2/register behind Cloudflare Access', () => {
  it('registers a public client when the request has no cookie and no Origin', async () => {
    const res = await mcpHelpers.registerOAuthClient({ body: publicClientBody });

    expect(res.statusCode).toBeGreaterThanOrEqual(200);
    expect(res.statusCode).toBeLessThan(300);
    expect(res.body.client_id).toEqual(expect.any(String));
  });

  it('registers a public client when only the CF_Authorization cookie is present and there is no Origin', async () => {
    const res = await mcpHelpers.registerOAuthClient({ body: publicClientBody, headers: CLOUDFLARE_ACCESS_HEADERS });

    expect(res.statusCode).toBeGreaterThanOrEqual(200);
    expect(res.statusCode).toBeLessThan(300);
    expect(res.body.client_id).toEqual(expect.any(String));
  });

  it('treats a request with only the CF_Authorization cookie as unauthenticated, downgrading a confidential client to public', async () => {
    const res = await mcpHelpers.registerOAuthClient({
      body: { ...publicClientBody, token_endpoint_auth_method: 'client_secret_basic' },
      headers: CLOUDFLARE_ACCESS_HEADERS,
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(200);
    expect(res.statusCode).toBeLessThan(300);
    expect(res.body.token_endpoint_auth_method).toBe('none');
  });
});
