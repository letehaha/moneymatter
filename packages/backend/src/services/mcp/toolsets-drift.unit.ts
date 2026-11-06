import { MCP_CORE_TOOLSET, MCP_OPTIONAL_TOOLSETS, MCP_TOOLSET_SCOPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

import { MCP_SCOPES_SUPPORTED, OAUTH_PROVIDER_SCOPES } from './oauth-scopes';
import { getToolNamesByToolset, TOOLSET_REGISTRARS } from './toolsets';

const TOOLS_DIR = path.join(__dirname, 'tools');
const WELL_KNOWN_DIR = path.resolve(__dirname, '../../../../frontend/public/.well-known');
const AUTH_CONFIG_PATH = path.resolve(__dirname, '../../config/auth.ts');

/**
 * `core` is what every client loads, so it stays small enough for a client that loads every tool
 * up front. A tool that doesn't fit goes to an optional toolset.
 */
const MAX_CORE_TOOLS = 60;

interface ServerCard {
  authentication: { oauth2: { scopes: string[] } };
  toolsets: Array<{ name: string; scope: string | null; description: string }>;
  tools: Array<{ name: string; toolset: string }>;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(WELL_KNOWN_DIR, file), 'utf-8'));

function toolNamesFromSources(): string[] {
  const names: string[] = [];
  for (const entry of fs.readdirSync(TOOLS_DIR)) {
    if (!entry.endsWith('.ts') || entry.includes('.unit.') || entry.includes('.e2e.')) continue;
    const content = fs.readFileSync(path.join(TOOLS_DIR, entry), 'utf-8');
    for (const match of content.matchAll(/server\.registerTool\(\s*['"]([^'"]+)['"]/g)) names.push(match[1]!);
  }
  return names.toSorted();
}

describe('MCP toolsets', () => {
  it('has a registrar list for core and for every optional toolset, and nothing else', () => {
    expect(Object.keys(TOOLSET_REGISTRARS)).toEqual([MCP_CORE_TOOLSET, ...MCP_OPTIONAL_TOOLSETS]);
  });

  it('puts every tool in exactly one toolset', () => {
    const listed = Object.values(getToolNamesByToolset()).flat();
    const duplicates = [...new Set(listed.filter((name, index) => listed.indexOf(name) !== index))];

    expect(duplicates).toEqual([]);
    expect(listed.toSorted()).toEqual(toolNamesFromSources());
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

  it('lists the advertised scopes in the static discovery mirrors', () => {
    for (const file of ['oauth-authorization-server', 'oauth-protected-resource']) {
      expect(readJson<{ scopes_supported: string[] }>(file).scopes_supported).toEqual([...MCP_SCOPES_SUPPORTED]);
    }
  });
});

describe('MCP toolsets in the server card', () => {
  const card = readJson<ServerCard>('mcp/server-card.json');

  it('lists the advertised scopes', () => {
    expect(card.authentication.oauth2.scopes).toEqual([...MCP_SCOPES_SUPPORTED]);
  });

  it('lists every toolset with its scope and a description', () => {
    expect(card.toolsets.map(({ name, scope }) => ({ name, scope }))).toEqual([
      { name: MCP_CORE_TOOLSET, scope: null },
      ...MCP_OPTIONAL_TOOLSETS.map((toolset, index) => ({ name: toolset, scope: MCP_TOOLSET_SCOPES[index] })),
    ]);
    for (const toolset of card.toolsets) expect(toolset.description).toBeTruthy();
  });

  it('names the toolset each tool is registered in', () => {
    const actual = Object.entries(getToolNamesByToolset()).flatMap(([toolset, names]) =>
      names.map((name) => ({ name, toolset })),
    );

    expect(card.tools.map(({ name, toolset }) => ({ name, toolset })).toSorted(byName)).toEqual(
      actual.toSorted(byName),
    );
  });
});
