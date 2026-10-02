import { afterEach, describe, expect, it } from '@jest/globals';
import * as mcpHelpers from '@tests/helpers/mcp';

const METHODS = ['post', 'get', 'delete'] as const;

// No session id and not an `initialize` call: a request that clears auth and the
// scope gate lands on the route's own 400, without reaching the (mocked) MCP SDK.
const NON_INITIALIZE_BODY = { jsonrpc: '2.0', id: 1, method: 'tools/list' };

describe('/mcp scope gate', () => {
  afterEach(async () => {
    await mcpHelpers.cleanupTestOAuthData();
  });

  it('rejects a request without a bearer token with 401', async () => {
    const res = await mcpHelpers.requestMcp({ body: NON_INITIALIZE_BODY });

    expect(res.status).toBe(401);
  });

  it.each([
    { label: 'profile:read only', scopes: ['profile:read'] },
    { label: 'finance:write without finance:read', scopes: ['finance:write', 'finance:delete'] },
    { label: 'no scopes', scopes: [] },
  ])('rejects a token with $label on every method with 403 insufficient_scope', async ({ scopes }) => {
    const token = await mcpHelpers.createTestMcpBearerToken({ scopes });

    for (const method of METHODS) {
      const res = await mcpHelpers.requestMcp({ method, token, body: NON_INITIALIZE_BODY });

      expect(res.status).toBe(403);
      expect(res.headers['www-authenticate']).toContain('error="insufficient_scope"');
      expect(res.headers['www-authenticate']).toContain(`scope="${['finance:read', ...scopes].join(' ')}"`);
    }
  });

  it('lets a token carrying finance:read through the gate on every method', async () => {
    const token = await mcpHelpers.createTestMcpBearerToken({ scopes: ['finance:read', 'profile:read'] });

    for (const method of METHODS) {
      const res = await mcpHelpers.requestMcp({ method, token, body: NON_INITIALIZE_BODY });

      expect(res.status).toBe(400);
    }
  });
});
