import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

import { MCP_SERVER_INFO } from '../services/mcp/server';
import { buildMcpMetadataFiles } from './generate-mcp-metadata';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SERVER_CARD_PATH = path.join(REPO_ROOT, 'packages/frontend/public/.well-known/mcp/server-card.json');
const REGISTRY_SERVER_JSON_PATH = path.join(REPO_ROOT, 'server.json');

describe('MCP metadata', () => {
  it('the committed server card, OAuth mirrors and SKILL.md match the generator', () => {
    const stale = Object.entries(buildMcpMetadataFiles())
      .filter(([file, content]) => fs.readFileSync(file, 'utf-8') !== content)
      .map(([file]) => path.relative(REPO_ROOT, file));

    if (stale.length) {
      throw new Error(
        `Stale MCP metadata: ${stale.join(', ')}. Run \`npm run mcp:generate-metadata\` in packages/backend.`,
      );
    }
  });

  it('registry server.json matches the server version and the card transport URL', () => {
    const registry = JSON.parse(fs.readFileSync(REGISTRY_SERVER_JSON_PATH, 'utf-8'));
    const card = JSON.parse(fs.readFileSync(SERVER_CARD_PATH, 'utf-8'));

    expect(registry.version).toBe(MCP_SERVER_INFO.version);
    expect(registry.remotes).toEqual([card.transport]);
    expect(registry.description.length).toBeLessThanOrEqual(100);
  });
});
