import type { McpOptionalToolset } from '@bt/shared/types';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  FINANCIAL_DATA_GUIDE_CONTENT,
  FINANCIAL_DATA_GUIDE_DESCRIPTION,
  FINANCIAL_DATA_GUIDE_NAME,
} from './prompts/financial-data-guide';
import { slimToolListing } from './tool-list-slimming';
import { registerToolsets } from './toolsets';

export const MCP_SERVER_INFO = {
  name: 'MoneyMatter Finance Tracker',
  version: '2.0.0',
};

export const MCP_PROMPTS = [
  {
    name: FINANCIAL_DATA_GUIDE_NAME,
    description: FINANCIAL_DATA_GUIDE_DESCRIPTION,
    text: FINANCIAL_DATA_GUIDE_CONTENT,
  },
];

/**
 * Creates a new MCP server instance with the prompts, the `core` tools and the tools of the given
 * toolsets. Each MCP session gets its own server instance; the toolsets come from the scopes the
 * user granted on the consent screen.
 *
 * After changing the tools, prompts or server info, run `npm run mcp:generate-metadata`.
 */
export function createMcpServer({ toolsets }: { toolsets: readonly McpOptionalToolset[] }): McpServer {
  const server = new McpServer(MCP_SERVER_INFO, {
    capabilities: {
      logging: {},
    },
  });
  slimToolListing({ server });

  for (const { name, description, text } of MCP_PROMPTS) {
    server.prompt(name, description, () => ({ messages: [{ role: 'user', content: { type: 'text', text } }] }));
  }

  registerToolsets({ server, toolsets });

  return server;
}
