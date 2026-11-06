import type { McpToolsetSummary } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { summarizeToolSelection } from './toolset-selection';

const TOOLSETS: McpToolsetSummary[] = [
  { id: 'core', scope: null, toolCount: 55 },
  { id: 'investments', scope: 'toolset:investments', toolCount: 29 },
  { id: 'budget-plans', scope: 'toolset:budget-plans', toolCount: 27 },
  { id: 'ventures', scope: 'toolset:ventures', toolCount: 20 },
];

describe('summarizeToolSelection', () => {
  it('counts core alone when nothing is selected', () => {
    const result = summarizeToolSelection({ toolsets: TOOLSETS, selectedScopes: new Set(), cap: 128 });

    expect(result.selectedCount).toBe(55);
    expect(result.totalCount).toBe(131);
    expect(result.overCap).toBe(false);
    expect(result.selectedPercent).toBeCloseTo((55 / 131) * 100);
  });

  it('adds each selected toolset to core', () => {
    const result = summarizeToolSelection({
      toolsets: TOOLSETS,
      selectedScopes: new Set(['toolset:investments', 'toolset:ventures']),
      cap: 128,
    });

    expect(result.selectedCount).toBe(104);
    expect(result.overCap).toBe(false);
  });

  it('flags a selection over the cap and places the cap on the bar', () => {
    const result = summarizeToolSelection({
      toolsets: TOOLSETS,
      selectedScopes: new Set(['toolset:investments', 'toolset:budget-plans', 'toolset:ventures']),
      cap: 128,
    });

    expect(result.selectedCount).toBe(131);
    expect(result.overCap).toBe(true);
    expect(result.selectedPercent).toBe(100);
    expect(result.capPercent).toBeCloseTo((128 / 131) * 100);
  });

  it('leaves the cap off the bar when every offered tool fits under it', () => {
    const result = summarizeToolSelection({ toolsets: TOOLSETS.slice(0, 2), selectedScopes: new Set(), cap: 128 });

    expect(result.capPercent).toBeNull();
  });

  it('ignores a selected scope that is not offered', () => {
    const result = summarizeToolSelection({
      toolsets: TOOLSETS.slice(0, 2),
      selectedScopes: new Set(['toolset:ventures']),
      cap: 128,
    });

    expect(result.selectedCount).toBe(55);
  });

  it('reports zero percent when nothing is offered', () => {
    const result = summarizeToolSelection({ toolsets: [], selectedScopes: new Set(), cap: 128 });

    expect(result).toEqual({ selectedCount: 0, totalCount: 0, selectedPercent: 0, capPercent: null, overCap: false });
  });
});
