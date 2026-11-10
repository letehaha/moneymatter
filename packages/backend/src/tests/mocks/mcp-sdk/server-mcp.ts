/**
 * Mock implementation of @modelcontextprotocol/sdk/server/mcp.js for Jest tests.
 *
 * As with the transport stub next to it, a test file cannot swap this module for the real one. A suite
 * that calls tools over `/mcp` calls `useRealMcpServer()` (with `useRealMcpTransport()`): while it is on,
 * constructing this class returns the SDK's own server.
 */
import { afterAll, beforeAll, jest } from '@jest/globals';
import path from 'node:path';

const REAL_SERVER_MODULE = path.join(
  __dirname,
  '../../../../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js',
);

const realServer = { enabled: false };

/** Makes every server the file's tests create the SDK's real one, and restores the stub afterwards. */
export function useRealMcpServer(): void {
  beforeAll(() => {
    realServer.enabled = true;
  });

  afterAll(() => {
    realServer.enabled = false;
  });
}

type ToolHandler = (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<unknown>;
type PromptHandler = (...args: unknown[]) => unknown;

export class McpServer {
  private tools = new Map<string, ToolHandler>();
  private prompts = new Map<string, PromptHandler>();

  constructor(...params: unknown[]) {
    if (realServer.enabled) {
      const real = jest.requireActual<{ McpServer: new (...params: unknown[]) => object }>(REAL_SERVER_MODULE);

      // A constructor that returns an object hands that object to `new` instead of this one.
      return new real.McpServer(...params) as McpServer;
    }
  }

  tool(name: string, description: string, schema: Record<string, unknown>, handler: ToolHandler): void {
    this.tools.set(name, handler);
  }

  prompt(name: string, description: string, handler: PromptHandler): void {
    this.prompts.set(name, handler);
  }

  async connect(_transport: unknown): Promise<void> {}
  async close(): Promise<void> {}
}
