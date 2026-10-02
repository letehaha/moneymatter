import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const TOOLS_DIR = path.join(__dirname, 'tools');

const READ_TOOL_NAME = /^(get|list|search|preview)_/;

// Tools that permanently delete a record without `delete_` in their name. Kept by
// hand: a new destructive tool named otherwise is only checked once it is listed here.
const DESTRUCTIVE_TOOLS = ['merge_payees'];

function readToolSources(): Array<{ name: string; content: string }> {
  const tools: Array<{ name: string; content: string }> = [];
  for (const entry of fs.readdirSync(TOOLS_DIR)) {
    if (!entry.endsWith('.ts') || entry.includes('.unit.') || entry.includes('.e2e.')) continue;

    const content = fs.readFileSync(path.join(TOOLS_DIR, entry), 'utf-8');
    if (!content.includes('server.registerTool(')) continue;

    const name = content.match(/server\.registerTool\(\s*['"]([^'"]+)['"]/)?.[1];
    if (!name) throw new Error(`Could not read the tool name registered in ${entry}`);
    tools.push({ name, content });
  }
  return tools;
}

describe('MCP tool scopes', () => {
  it('every tool that is not a read tool checks a scope', () => {
    const unchecked = readToolSources()
      .filter((t) => !READ_TOOL_NAME.test(t.name) && !t.content.includes('requireScope('))
      .map((t) => t.name);

    expect(unchecked).toEqual([]);
  });

  it('every tool that permanently deletes a record requires finance:delete', () => {
    const tools = readToolSources();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(DESTRUCTIVE_TOOLS));

    const wrongScope = tools
      .filter((t) => t.name.startsWith('delete_') || DESTRUCTIVE_TOOLS.includes(t.name))
      .filter(
        (t) =>
          !t.content.includes("requireScope({ extra, scope: 'finance:delete' })") ||
          t.content.includes("scope: 'finance:write'"),
      )
      .map((t) => t.name);

    expect(wrongScope).toEqual([]);
  });
});
