import type { McpOptionalToolset } from '@bt/shared/types';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  FINANCIAL_DATA_GUIDE_CONTENT,
  FINANCIAL_DATA_GUIDE_DESCRIPTION,
  FINANCIAL_DATA_GUIDE_NAME,
} from './prompts/financial-data-guide';
import { slimToolListing } from './tool-list-slimming';
import { registerToolsets } from './toolsets';

/**
 * Creates a new MCP server instance with the prompts, the `core` tools and the tools of the given
 * toolsets. Each MCP session gets its own server instance; the toolsets come from the scopes the
 * user granted on the consent screen.
 *
 * When adding, removing, or renaming tools / prompts, also update:
 *   packages/frontend/public/.well-known/mcp/server-card.json
 * The drift test at ./server-card-drift.unit.ts will fail otherwise. Tools are registered
 * through ./toolsets.ts.
 */
export function createMcpServer({ toolsets }: { toolsets: readonly McpOptionalToolset[] }): McpServer {
  const server = new McpServer(
    {
      name: 'MoneyMatter Finance Tracker',
      version: '2.0.0',
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );
  slimToolListing({ server });

  // Register the financial data guide prompt
  server.prompt(FINANCIAL_DATA_GUIDE_NAME, FINANCIAL_DATA_GUIDE_DESCRIPTION, () => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: FINANCIAL_DATA_GUIDE_CONTENT,
        },
      },
    ],
  }));

  registerToolsets({ server, toolsets });

  return server;
}
