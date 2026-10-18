import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const TOOLS_DIR = path.join(__dirname, 'tools');

const READ_TOOL_NAME = /^(get|list|search|preview)_/;

// Tools that permanently delete a record without `delete_` in their name. Kept by
// hand: a new destructive tool named otherwise is only checked once it is listed here.
const DESTRUCTIVE_TOOLS = ['merge_payees', 'bulk_delete_transactions'];

// Tools that check a scope but whose REST route carries no `checkBaseCurrencyLock`, so they
// skip `assertBaseCurrencyUnlocked`. Kept by hand, one route per entry: the lock follows the
// route, not the tool's name or scope. Add a tool here only after reading its route.
const LOCK_EXEMPT_TOOLS = [
  // POST /transactions/:transactionId/attachments has no lock: attachments touch no amounts.
  'create_attachment_upload_url',
  // GET /subscriptions/detect-candidates is a read in REST.
  'detect_subscription_candidates',
  // POST /user/currencies/change-base has no lock: the enqueue takes its own NX lock. The tool is
  // exempt in that branch only; its first-base branch (POST /user/currencies/base) carries the
  // lock, so it is also in LOCK_EXEMPT_IN_ONE_BRANCH and calls it there.
  'change_base_currency',
  // DELETE /attachments/:id has no lock: attachments touch no amounts.
  'delete_attachment',
];

// Lock-exempt tools that still call `assertBaseCurrencyUnlocked` in one branch, because their
// branches follow two REST routes with different guards.
const LOCK_EXEMPT_IN_ONE_BRANCH = ['change_base_currency'];

// Read-named tools whose REST route carries `checkBaseCurrencyLock`, so REST refuses them with
// 423 during a base-currency change and the tool must too. They call no scope helper.
const LOCK_GUARDED_READ_TOOLS = [
  // POST /automations/preview
  'preview_transaction_automation',
];

// The only tools that may pass `allowReadOnly: true` to `requireScope`: each sits on a route in
// `READ_ONLY_ROUTES` (`middlewares/entitlements.ts`), which a read-only user may call. Kept by
// hand so the exemption cannot spread. The tools arrive with their tasks.
const READ_ONLY_ROUTE_TOOLS = [
  // POST /notifications/read-all and POST /notifications/:id/read
  'mark_notifications_read',
  // PUT and PATCH /user/settings
  'update_user_settings',
  // POST /user/currencies/base, the first base currency only
  'change_base_currency',
];

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
    const goalWrites = readToolSources().filter((t) => /_goals?$/.test(t.name) && !READ_TOOL_NAME.test(t.name));
    expect(goalWrites.map((t) => t.name)).toEqual(
      expect.arrayContaining(['create_goal', 'update_goal', 'delete_goal']),
    );

    const ungated = goalWrites
      .filter((t) => !t.content.includes('requireFeature({ userId, feature: FEATURES.goals })'))
      .map((t) => t.name);

    expect(ungated).toEqual([]);
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
});
