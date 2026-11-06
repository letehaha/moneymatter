import {
  MCP_CORE_TOOLSET,
  MCP_OPTIONAL_TOOLSETS,
  type McpOptionalToolset,
  mcpToolsetsFromScopes,
} from '@bt/shared/types';
import { describe, expect, it, jest } from '@jest/globals';

// The unit suite maps the MCP SDK to a stub; these checks need the real server and the real
// `tools/list` handler, so the stub is swapped for the SDK's own CommonJS build.
const SDK_DIST = '../../../../../node_modules/@modelcontextprotocol/sdk/dist/cjs';
jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () =>
  jest.requireActual('../../../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js'),
);

/**
 * A client that loads every tool up front pays for the whole `tools/list` result of `core` on
 * every conversation, so the budget covers `core`; the optional toolsets are the user's choice
 * on the consent screen. 80,000 bytes is about 20k tokens; core came to about 66,000 when the
 * budget was set.
 */
const CORE_TOOLS_LIST_BUDGET_BYTES = 80_000;

async function listTools({ toolsets }: { toolsets: readonly McpOptionalToolset[] }) {
  const { createMcpServer } = await import('./server');
  const { InMemoryTransport } = jest.requireActual(`${SDK_DIST}/inMemory.js`) as any;
  const { Client } = jest.requireActual(`${SDK_DIST}/client/index.js`) as any;

  const server = createMcpServer({ toolsets });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'size-check', version: '1.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

  const result = (await client.listTools()) as { tools: Array<{ name: string }> };
  await client.close();
  return result;
}

describe('MCP tools/list', () => {
  it('keeps core within the budget', async () => {
    const result = await listTools({ toolsets: [] });

    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(CORE_TOOLS_LIST_BUDGET_BYTES);
  });

  it('lists only core when no toolset is granted', async () => {
    const { getToolNamesByToolset } = await import('./toolsets');
    const result = await listTools({ toolsets: [] });

    expect(result.tools.map((tool) => tool.name).toSorted()).toEqual(
      getToolNamesByToolset()[MCP_CORE_TOOLSET].toSorted(),
    );
  });

  it('adds the tools of the granted toolsets to core, and only those', async () => {
    const { getToolNamesByToolset } = await import('./toolsets');
    const names = getToolNamesByToolset();
    const result = await listTools({ toolsets: ['investments', 'budget-plans'] });

    expect(result.tools.map((tool) => tool.name).toSorted()).toEqual(
      [...names[MCP_CORE_TOOLSET], ...names.investments, ...names['budget-plans']].toSorted(),
    );
  });

  it('registers every tool when every toolset is granted', async () => {
    const { getToolNamesByToolset } = await import('./toolsets');
    const result = await listTools({ toolsets: MCP_OPTIONAL_TOOLSETS });

    expect(result.tools).toHaveLength(Object.values(getToolNamesByToolset()).flat().length);
  });
});

describe('mcpToolsetsFromScopes', () => {
  it('returns no toolset when no toolset scope is granted', () => {
    expect(mcpToolsetsFromScopes({ scopes: ['finance:read', 'finance:write', 'profile:read'] })).toEqual([]);
  });

  it('returns the granted toolsets once each, in MCP_OPTIONAL_TOOLSETS order', () => {
    const scopes = ['toolset:loans-vehicles', 'finance:read', 'toolset:subscriptions', 'toolset:loans-vehicles'];

    expect(mcpToolsetsFromScopes({ scopes })).toEqual(['subscriptions', 'loans-vehicles']);
  });

  it('ignores unknown toolset scopes and non-toolset scopes', () => {
    const scopes = ['toolset:bogus', 'toolset:', 'core', 'toolset:core', 'investments', 'toolset:investments'];

    expect(mcpToolsetsFromScopes({ scopes })).toEqual(['investments']);
  });
});

describe('MCP tools/list from granted scopes', () => {
  it('lists the tools of a granted toolset scope and not those of an ungranted one', async () => {
    const result = await listTools({
      toolsets: mcpToolsetsFromScopes({ scopes: ['finance:read', 'toolset:loans-vehicles'] }),
    });
    const names = result.tools.map((tool) => tool.name);

    expect(names).toContain('get_vehicles');
    expect(names).not.toContain('get_portfolios');
  });
});
