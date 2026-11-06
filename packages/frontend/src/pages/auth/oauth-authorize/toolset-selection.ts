import type { McpToolsetSummary } from '@bt/shared/types';

export interface ToolSelection {
  selectedCount: number;
  totalCount: number;
  /** Share of all offered tools that is selected, 0–100. */
  selectedPercent: number;
  /** Where the client tool cap sits on the same scale, or `null` when every tool fits under it. */
  capPercent: number | null;
  overCap: boolean;
}

/**
 * Counts the tools a consent selection grants: `core` always, plus each selected toolset.
 * `toolsets` holds only what the client may be granted, `core` included.
 */
export function summarizeToolSelection({
  toolsets,
  selectedScopes,
  cap,
}: {
  toolsets: readonly McpToolsetSummary[];
  selectedScopes: ReadonlySet<string>;
  cap: number;
}): ToolSelection {
  let selectedCount = 0;
  let totalCount = 0;
  for (const toolset of toolsets) {
    totalCount += toolset.toolCount;
    if (toolset.scope === null || selectedScopes.has(toolset.scope)) selectedCount += toolset.toolCount;
  }

  const percentOf = (count: number) => (totalCount === 0 ? 0 : Math.min(100, (count / totalCount) * 100));

  return {
    selectedCount,
    totalCount,
    selectedPercent: percentOf(selectedCount),
    capPercent: totalCount > cap ? percentOf(cap) : null,
    overCap: selectedCount > cap,
  };
}
