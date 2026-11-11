import { mcpToolsetScope } from '@bt/shared/types';
import { afterEach, describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import * as mcpHelpers from '@tests/helpers/mcp';
import { randomUUID } from 'node:crypto';

const INITIALIZE_BODY = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1.0.0' } },
};

const toolText = ({ res }: { res: Awaited<ReturnType<typeof mcpHelpers.callMcpTool>> }): string => {
  const message = mcpHelpers.readMcpMessage({ res });
  const content = message.result?.content as Array<{ type: string; text: string }> | undefined;
  return content?.[0]?.text ?? '';
};

// The public `/mcp` keeps no session: an idle timeout or a restart has nothing to end, so a client is
// never told its session is gone.
describe('/mcp without sessions', () => {
  afterEach(async () => {
    await mcpHelpers.cleanupTestOAuthData();
  });

  it('answers initialize without issuing a session id', async () => {
    const token = await mcpHelpers.createTestMcpBearerToken({ scopes: ['finance:read'] });

    const res = await mcpHelpers.requestMcp({ token, body: INITIALIZE_BODY });

    expect(res.status).toBe(200);
    expect(res.headers['mcp-session-id']).toBeUndefined();
    expect(mcpHelpers.readMcpMessage({ res }).result).toMatchObject({
      serverInfo: { name: 'MoneyMatter Finance Tracker' },
    });
  });

  it('runs a tool call that no initialize came before', async () => {
    const token = await mcpHelpers.createTestMcpBearerToken({ scopes: ['finance:read'] });
    await helpers.createAccount({ payload: helpers.buildAccountPayload({ name: 'Stateless wallet' }), raw: true });

    const res = await mcpHelpers.callMcpTool({ token, name: 'get_accounts' });

    expect(res.status).toBe(200);
    expect(toolText({ res })).toContain('Stateless wallet');
  });

  it('runs a tool call that carries a session id the server never issued, as after a restart', async () => {
    const token = await mcpHelpers.createTestMcpBearerToken({ scopes: ['finance:read'] });
    await helpers.createAccount({ payload: helpers.buildAccountPayload({ name: 'Restart wallet' }), raw: true });

    const res = await mcpHelpers.callMcpTool({ token, name: 'get_accounts', sessionId: randomUUID() });

    expect(res.status).toBe(200);
    expect(toolText({ res })).toContain('Restart wallet');
  });

  it("lists the toolsets of each request's own token", async () => {
    const coreOnly = await mcpHelpers.createTestMcpBearerToken({ scopes: ['finance:read'] });
    const withInvestments = await mcpHelpers.createTestMcpBearerToken({
      scopes: ['finance:read', mcpToolsetScope({ toolset: 'investments' })],
    });
    const listTools = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    const toolNames = async ({ token }: { token: string }) => {
      const res = await mcpHelpers.requestMcp({ token, body: listTools });
      const tools = mcpHelpers.readMcpMessage({ res }).result?.tools as Array<{ name: string }>;
      return tools.map((tool) => tool.name);
    };

    expect(await toolNames({ token: coreOnly })).not.toContain('search_securities');
    expect(await toolNames({ token: withInvestments })).toContain('search_securities');
  });

  it('answers 405 to GET and DELETE, since there is no stream or session to open or end', async () => {
    const token = await mcpHelpers.createTestMcpBearerToken({ scopes: ['finance:read'] });

    for (const method of ['get', 'delete'] as const) {
      const res = await mcpHelpers.requestMcp({ method, token, sessionId: randomUUID() });

      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('POST');
    }
  });

  it('answers 503 to requests past the in-flight limit and serves again once they finish', async () => {
    const token = await mcpHelpers.createTestMcpBearerToken({ scopes: ['finance:read'] });
    process.env.MCP_MAX_IN_FLIGHT_REQUESTS = '2';

    try {
      const responses = await Promise.all(
        Array.from({ length: 20 }, () => mcpHelpers.callMcpTool({ token, name: 'get_accounts' })),
      );
      const statuses = responses.map((res) => res.status);

      expect(statuses.filter((status) => status !== 200 && status !== 503)).toEqual([]);
      expect(statuses).toContain(200);
      expect(statuses).toContain(503);
      const rejected = responses.find((res) => res.status === 503)!;
      expect(rejected.headers['retry-after']).toBe('5');
      expect(rejected.body.error).toMatchObject({ code: -32000, message: expect.stringContaining('overloaded') });

      // A leaked slot would keep the counter at the limit and reject this call too.
      const next = await mcpHelpers.callMcpTool({ token, name: 'get_accounts' });
      expect(next.status).toBe(200);
    } finally {
      delete process.env.MCP_MAX_IN_FLIGHT_REQUESTS;
    }
  });

  it('still requires a token on a tool call', async () => {
    const res = await mcpHelpers.requestMcp({
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_accounts', arguments: {} } },
    });

    expect(res.status).toBe(401);
  });
});
