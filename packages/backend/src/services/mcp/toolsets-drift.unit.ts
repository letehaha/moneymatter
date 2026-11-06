import { MCP_CORE_TOOLSET, MCP_OPTIONAL_TOOLSETS, MCP_TOOLSET_SCOPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

import type { ToolDef } from './define-tool';
import { MCP_SCOPES_SUPPORTED, OAUTH_PROVIDER_SCOPES } from './oauth-scopes';
import { ALL_TOOLS, getToolNamesByToolset } from './toolsets';

const TOOLS_DIR = path.join(__dirname, 'tools');
const AUTH_CONFIG_PATH = path.resolve(__dirname, '../../config/auth.ts');

/**
 * `core` is what every client loads, so it stays small enough for a client that loads every tool
 * up front. A tool that doesn't fit goes to an optional toolset.
 */
const MAX_CORE_TOOLS = 60;

/** Every def the tool modules export, so a tool missing from `ALL_TOOLS` shows up. */
function defsFromToolModules(): ToolDef[] {
  return fs
    .readdirSync(TOOLS_DIR)
    .filter((entry) => entry.endsWith('.ts') && !entry.includes('.unit.') && !entry.includes('.e2e.'))
    .flatMap((entry) => Object.values(require(path.join(TOOLS_DIR, entry)) as Record<string, unknown>))
    .filter((value): value is ToolDef => typeof value === 'object' && value !== null && 'run' in value);
}

describe('MCP toolsets', () => {
  it('puts every tool in exactly one known toolset', () => {
    const toolsets: readonly string[] = [MCP_CORE_TOOLSET, ...MCP_OPTIONAL_TOOLSETS];
    expect(ALL_TOOLS.filter((def) => !toolsets.includes(def.toolset)).map((def) => def.name)).toEqual([]);

    const names = ALL_TOOLS.map((def) => def.name);
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
  });

  it('gives every tool a non-empty description', () => {
    expect(ALL_TOOLS.filter((def) => !def.description.trim()).map((def) => def.name)).toEqual([]);
  });

  it('lists every tool def the tool modules export', () => {
    expect(ALL_TOOLS.map((def) => def.name).toSorted()).toEqual(
      defsFromToolModules()
        .map((def) => def.name)
        .toSorted(),
    );
  });

  it('gives every toolset at least one tool', () => {
    const empty = Object.entries(getToolNamesByToolset())
      .filter(([, names]) => names.length === 0)
      .map(([toolset]) => toolset);

    expect(empty).toEqual([]);
  });

  it(`keeps core at ${MAX_CORE_TOOLS} tools or fewer`, () => {
    expect(getToolNamesByToolset()[MCP_CORE_TOOLSET].length).toBeLessThanOrEqual(MAX_CORE_TOOLS);
  });
});

describe('MCP toolset scopes', () => {
  it('advertises every toolset scope and lets the OAuth provider accept it', () => {
    expect(MCP_SCOPES_SUPPORTED).toEqual(expect.arrayContaining([...MCP_TOOLSET_SCOPES]));
    expect(OAUTH_PROVIDER_SCOPES).toEqual(expect.arrayContaining([...MCP_TOOLSET_SCOPES]));
  });

  it('passes the shared scope list to the OAuth provider in config/auth.ts', () => {
    expect(fs.readFileSync(AUTH_CONFIG_PATH, 'utf-8')).toContain('scopes: [...OAUTH_PROVIDER_SCOPES]');
  });
});
