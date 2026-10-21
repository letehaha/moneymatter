import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

import {
  CONDITIONAL_DELETE_TOOLS,
  DESTRUCTIVE_TOOLS,
  LOCK_EXEMPT_TOOLS,
  LOCK_GUARDED_READ_TOOLS,
  READ_ONLY_ROUTE_TOOLS,
  READ_TOOL_NAME,
} from './tool-classification';

const TOOLS_DIR = path.join(__dirname, 'tools');
const SERVER_CARD_PATH = path.resolve(__dirname, '../../../../frontend/public/.well-known/mcp/server-card.json');

// Lock-exempt tools that still call `assertBaseCurrencyUnlocked` in one branch, because their
// branches follow two REST routes with different guards.
const LOCK_EXEMPT_IN_ONE_BRANCH = ['change_base_currency'];

// Budget plan writes sit behind `requireFeature(FEATURES.budget_plan)` in REST, so every write tool
// on `/budget-plans` calls `requireFeature` for it. The one exception is kept by hand:
// `DELETE /budget-plans/:planId` is ungated, because an active plan blocks base-currency changes
// and a lapsed user must be able to drop it.
const BUDGET_PLAN_UNGATED_TOOLS = ['delete_budget_plan'];

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

  it('every goal write tool requires the goals feature', () => {
    const goalWrites = readToolSources().filter((t) => /^(create|update|delete)_goal$/.test(t.name));
    expect(goalWrites.map((t) => t.name)).toEqual(
      expect.arrayContaining(['create_goal', 'update_goal', 'delete_goal']),
    );

    const ungated = goalWrites
      .filter((t) => !t.content.includes('requireFeature({ userId, feature: FEATURES.goals })'))
      .map((t) => t.name);

    expect(ungated).toEqual([]);
  });

  it('every tool with an optional delete path requires finance:write and checks finance:delete where it deletes', () => {
    const tools = readToolSources();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(CONDITIONAL_DELETE_TOOLS));
    expect(CONDITIONAL_DELETE_TOOLS.filter((name) => DESTRUCTIVE_TOOLS.includes(name))).toEqual([]);

    const wrong = tools
      .filter((t) => CONDITIONAL_DELETE_TOOLS.includes(t.name))
      .filter(
        (t) =>
          t.name.startsWith('delete_') ||
          !t.content.includes("requireScope({ extra, scope: 'finance:write' })") ||
          !t.content.includes("requireScope({ extra, scope: 'finance:delete' })"),
      )
      .map((t) => t.name);

    expect(wrong).toEqual([]);
  });

  it('every tool that checks a scope checks the base-currency lock right after it, unless its route has none', () => {
    const tools = readToolSources().filter((t) => t.content.includes('requireScope('));

    const missing = tools
      .filter((t) => !LOCK_EXEMPT_TOOLS.includes(t.name) && !t.content.includes('await assertBaseCurrencyUnlocked({'))
      .map((t) => t.name);
    expect(missing).toEqual([]);

    const misplaced = tools
      .filter((t) => t.content.includes('await assertBaseCurrencyUnlocked({'))
      .filter((t) => t.content.indexOf('requireScope(') > t.content.indexOf('assertBaseCurrencyUnlocked('))
      .map((t) => t.name);
    expect(misplaced).toEqual([]);
  });

  it('every lock-exempt tool exists, checks a scope and does not check the lock, except in a listed branch', () => {
    const tools = readToolSources();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(LOCK_EXEMPT_TOOLS));
    expect(LOCK_EXEMPT_IN_ONE_BRANCH.filter((name) => !LOCK_EXEMPT_TOOLS.includes(name))).toEqual([]);

    const wrong = tools
      .filter((t) => LOCK_EXEMPT_TOOLS.includes(t.name))
      .filter((t) => !t.content.includes('requireScope('))
      .map((t) => t.name);
    expect(wrong).toEqual([]);

    const checksLock = tools
      .filter((t) => LOCK_EXEMPT_TOOLS.includes(t.name))
      .filter((t) => t.content.includes('assertBaseCurrencyUnlocked('))
      .map((t) => t.name);
    expect(checksLock.toSorted()).toEqual(LOCK_EXEMPT_IN_ONE_BRANCH.toSorted());
  });

  it('every read tool on a lock-carrying route checks the lock', () => {
    const tools = readToolSources();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(LOCK_GUARDED_READ_TOOLS));
    expect(LOCK_GUARDED_READ_TOOLS.filter((name) => LOCK_EXEMPT_TOOLS.includes(name))).toEqual([]);

    const unguarded = tools
      .filter((t) => LOCK_GUARDED_READ_TOOLS.includes(t.name))
      .filter((t) => !READ_TOOL_NAME.test(t.name) || !t.content.includes('await assertBaseCurrencyUnlocked({'))
      .map((t) => t.name);
    expect(unguarded).toEqual([]);
  });

  it('only the tools on READ_ONLY_ROUTES routes pass allowReadOnly', () => {
    const spread = readToolSources()
      .filter((t) => t.content.includes('allowReadOnly: true'))
      .filter((t) => !READ_ONLY_ROUTE_TOOLS.includes(t.name))
      .map((t) => t.name);

    expect(spread).toEqual([]);
  });

  it('every budget plan write tool checks the budget_plan feature, except the ungated delete', () => {
    const tools = readToolSources();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(BUDGET_PLAN_UNGATED_TOOLS));

    const writes = tools.filter((t) => t.name.includes('budget_plan') && !READ_TOOL_NAME.test(t.name));
    expect(writes.length).toBeGreaterThan(0);

    const gate = 'requireFeature({ userId, feature: FEATURES.budget_plan })';
    const ungated = writes.filter((t) => !t.content.includes(gate)).map((t) => t.name);
    expect(ungated.toSorted()).toEqual(BUDGET_PLAN_UNGATED_TOOLS.toSorted());
  });

  it('every scope a server-card description requires is checked by the tool', () => {
    const card: { tools: Array<{ name: string; description: string }> } = JSON.parse(
      fs.readFileSync(SERVER_CARD_PATH, 'utf-8'),
    );
    const sources = new Map(readToolSources().map((t) => [t.name, t.content]));

    const mismatched = card.tools
      .map((tool) => ({ name: tool.name, documented: tool.description.match(/Requires (finance:\w+) scope/)?.[1] }))
      .filter((tool) => tool.documented)
      .filter((tool) => !sources.get(tool.name)?.includes(`requireScope({ extra, scope: '${tool.documented}'`))
      .map((tool) => tool.name);

    expect(mismatched).toEqual([]);
  });

  it('a tool that unlinks records requires finance:write, because linking them again undoes it', () => {
    const unlinkTools = readToolSources().filter((t) => t.name.startsWith('unlink_'));
    expect(unlinkTools.map((t) => t.name)).toEqual(expect.arrayContaining(['unlink_refund', 'unlink_transfer']));

    const wrongScope = unlinkTools
      .filter((t) => !t.content.includes("requireScope({ extra, scope: 'finance:write' })"))
      .map((t) => t.name);

    expect(wrongScope).toEqual([]);
  });
});
