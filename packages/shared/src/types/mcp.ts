// MCP toolsets. `core` is always registered; every other toolset is granted through its own OAuth
// scope (`toolset:<id>`), which the user picks on the consent screen.
export const MCP_CORE_TOOLSET = 'core';

export const MCP_OPTIONAL_TOOLSETS = [
  'subscriptions',
  'budget-plans',
  'trackers',
  'automations',
  'review',
  'groups-templates',
  'investments',
  'ventures',
  'loans-vehicles',
  'currencies',
  'imports',
] as const;

export type McpOptionalToolset = (typeof MCP_OPTIONAL_TOOLSETS)[number];
export type McpToolset = typeof MCP_CORE_TOOLSET | McpOptionalToolset;

export const MCP_TOOLSET_SCOPE_PREFIX = 'toolset:';

export type McpToolsetScope = `${typeof MCP_TOOLSET_SCOPE_PREFIX}${McpOptionalToolset}`;

export const mcpToolsetScope = ({ toolset }: { toolset: McpOptionalToolset }): McpToolsetScope =>
  `${MCP_TOOLSET_SCOPE_PREFIX}${toolset}`;

export const MCP_TOOLSET_SCOPES: readonly McpToolsetScope[] = MCP_OPTIONAL_TOOLSETS.map((toolset) =>
  mcpToolsetScope({ toolset }),
);

/** The optional toolsets a list of granted OAuth scopes unlocks, in `MCP_OPTIONAL_TOOLSETS` order. */
export const mcpToolsetsFromScopes = ({ scopes }: { scopes: readonly string[] }): McpOptionalToolset[] =>
  MCP_OPTIONAL_TOOLSETS.filter((toolset) => scopes.includes(mcpToolsetScope({ toolset })));

/**
 * OpenAI function calling and VS Code Copilot refuse a request with more tools than this, so the
 * consent screen warns when the selection goes over it.
 */
export const MCP_CLIENT_TOOL_CAP = 128;

export interface McpToolsetSummary {
  id: McpToolset;
  /** `null` for `core`, which needs no scope. */
  scope: McpToolsetScope | null;
  toolCount: number;
}

export interface GetMcpToolsetsResponse {
  toolsets: McpToolsetSummary[];
}
