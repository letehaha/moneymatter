import { describe, expect, it, jest } from '@jest/globals';

// The unit suite maps the MCP SDK to a stub; this budget needs the real server and the real
// `tools/list` handler, so the stub is swapped for the SDK's own CommonJS build.
const SDK_DIST = '../../../../../node_modules/@modelcontextprotocol/sdk/dist/cjs';
jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () =>
  jest.requireActual('../../../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js'),
);

/**
 * A client that loads every tool up front pays for the whole `tools/list` result. 320,000 bytes
 * is about 80k tokens; the budget leaves room for the Apple Pay tools. Lazy clients such as
 * Claude Code only pay for names. It was 300,000 until the write tools gained the REST fields they
 * lacked (a subscription's matching rules, the payee and transaction details, the settlement leg of an investment trade, a tracker's logo, ...), which added
 * about 20,000 bytes.
 */
const TOOLS_LIST_BUDGET_BYTES = 320_000;

describe('MCP tools/list size', () => {
  it('stays within the budget', async () => {
    const { createMcpServer } = await import('./server');
    const { InMemoryTransport } = jest.requireActual(`${SDK_DIST}/inMemory.js`) as any;
    const { Client } = jest.requireActual(`${SDK_DIST}/client/index.js`) as any;

    const server = createMcpServer();
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'size-check', version: '1.0.0' });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

    const result = await client.listTools();
    const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
    await client.close();

    expect(result.tools.length).toBeGreaterThan(200);
    expect(bytes).toBeLessThanOrEqual(TOOLS_LIST_BUDGET_BYTES);
  });
});
