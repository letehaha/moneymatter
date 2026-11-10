/**
 * Mock implementation of @modelcontextprotocol/sdk/server/streamableHttp.js for Jest tests.
 *
 * The app is loaded by the e2e setup before any test file runs, so a `jest.mock` in a test file cannot
 * swap this module for the real one. A suite that talks to a real MCP endpoint calls
 * `useRealMcpTransport()`: while it is on, constructing this class returns the SDK's own transport.
 */
import { afterAll, beforeAll, jest } from '@jest/globals';
import path from 'node:path';

const REAL_TRANSPORT_MODULE = path.join(
  __dirname,
  '../../../../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/streamableHttp.js',
);

const realTransport = { enabled: false };

/** Makes every transport the file's tests create the SDK's real one, and restores the stub afterwards. */
export function useRealMcpTransport(): void {
  beforeAll(() => {
    realTransport.enabled = true;
  });

  afterAll(() => {
    realTransport.enabled = false;
  });
}

export class StreamableHTTPServerTransport {
  sessionId: string | null = null;
  onclose: (() => void) | null = null;

  constructor(options?: unknown) {
    if (realTransport.enabled) {
      const real = jest.requireActual<{ StreamableHTTPServerTransport: new (options?: unknown) => object }>(
        REAL_TRANSPORT_MODULE,
      );

      // A constructor that returns an object hands that object to `new` instead of this one.
      return new real.StreamableHTTPServerTransport(options) as StreamableHTTPServerTransport;
    }
  }

  async handleRequest(_req: unknown, _res: unknown, _body?: unknown): Promise<void> {}
  async close(): Promise<void> {}
}
