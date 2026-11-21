import { describe, expect, it } from '@jest/globals';
import * as mcpHelpers from '@tests/helpers/mcp';

const publicClientBody = {
  client_name: 'Cloudflare Access MCP client',
  redirect_uris: ['http://localhost:34567/callback'],
  token_endpoint_auth_method: 'none',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
};

describe('POST /auth/oauth2/register behind Cloudflare Access', () => {
  it('registers a client when only Cloudflare Access cookies are present and there is no Origin', async () => {
    const res = await mcpHelpers.registerOAuthClient({
      body: publicClientBody,
      headers: { Cookie: 'CF_Authorization=dummy; CF_AppSession=dummy' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.body.client_id).toEqual(expect.any(String));
  });

  it('still requires an Origin when any other cookie is present', async () => {
    const res = await mcpHelpers.registerOAuthClient({
      body: publicClientBody,
      headers: { Cookie: 'CF_Authorization=dummy; theme=dark' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('MISSING_OR_NULL_ORIGIN');
  });
});
