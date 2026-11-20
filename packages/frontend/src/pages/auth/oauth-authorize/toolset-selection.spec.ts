import { HIDDEN_OAUTH_SCOPES } from '@/common/const/oauth-scopes';
import type { McpToolsetSummary } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { approveScopes, summarizeToolSelection } from './toolset-selection';

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

describe('approveScopes', () => {
  const TOGGLABLE = new Set(['finance:write', 'finance:delete']);
  const approve = (overrides: Partial<Parameters<typeof approveScopes>[0]> = {}) =>
    approveScopes({
      requestedScopes: ['finance:read', 'toolset:investments', 'toolset:ventures'],
      offeredToolsets: TOOLSETS,
      selectedToolsetScopes: new Set(),
      togglableScopes: TOGGLABLE,
      approvals: {},
      ...overrides,
    });

  it('never grants a toolset scope the client did not request', () => {
    const result = approve({ selectedToolsetScopes: new Set(['toolset:investments', 'toolset:budget-plans']) });

    expect(result).toEqual(['finance:read', 'toolset:investments']);
  });

  it('drops an offered toolset the user left unticked and keeps a ticked one', () => {
    const result = approve({ selectedToolsetScopes: new Set(['toolset:ventures']) });

    expect(result).toEqual(['finance:read', 'toolset:ventures']);
  });

  it('drops a requested and ticked toolset the backend does not offer', () => {
    const result = approve({
      offeredToolsets: [],
      selectedToolsetScopes: new Set(['toolset:investments', 'toolset:ventures']),
    });

    expect(result).toEqual(['finance:read']);
  });

  it('drops a togglable scope the user turned off or never approved', () => {
    const result = approve({
      requestedScopes: ['finance:read', 'finance:write', 'finance:delete'],
      approvals: { 'finance:write': false },
    });

    expect(result).toEqual(['finance:read']);
  });

  it('keeps a togglable scope the user approved', () => {
    const result = approve({
      requestedScopes: ['finance:read', 'finance:write', 'finance:delete'],
      approvals: { 'finance:write': true, 'finance:delete': true },
    });

    expect(result).toEqual(['finance:read', 'finance:write', 'finance:delete']);
  });

  it('keeps hidden and unknown scopes', () => {
    const [hidden] = HIDDEN_OAUTH_SCOPES;
    const result = approve({ requestedScopes: [hidden!, 'some:unknown', 'profile:read'] });

    expect(result).toEqual([hidden, 'some:unknown', 'profile:read']);
  });

  it('follows the requested order', () => {
    const result = approve({
      requestedScopes: ['toolset:ventures', 'offline_access', 'finance:write', 'toolset:investments', 'finance:read'],
      selectedToolsetScopes: new Set(['toolset:investments', 'toolset:ventures']),
      approvals: { 'finance:write': true },
    });

    expect(result).toEqual([
      'toolset:ventures',
      'offline_access',
      'finance:write',
      'toolset:investments',
      'finance:read',
    ]);
  });
});
