import {
  type GetMcpToolsetsResponse,
  MCP_CORE_TOOLSET,
  MCP_OPTIONAL_TOOLSETS,
  mcpToolsetScope,
} from '@bt/shared/types';

import { getToolNamesByToolset } from './toolsets';

/** Each toolset with its scope and tool count, `core` first, for the consent screen. */
export function getToolsetSummaries(): GetMcpToolsetsResponse {
  const toolNames = getToolNamesByToolset();

  return {
    toolsets: [
      { id: MCP_CORE_TOOLSET, scope: null, toolCount: toolNames[MCP_CORE_TOOLSET].length },
      ...MCP_OPTIONAL_TOOLSETS.map((toolset) => ({
        id: toolset,
        scope: mcpToolsetScope({ toolset }),
        toolCount: toolNames[toolset].length,
      })),
    ],
  };
}
