import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const TOOLS_DIR = path.join(__dirname, 'tools');

const READ_TOOL_NAME = /^(get|list|search|preview)_/;

// Tools that permanently delete a record without `delete_` in their name. Kept by
// hand: a new destructive tool named otherwise is only checked once it is listed here.
const DESTRUCTIVE_TOOLS = ['merge_payees', 'bulk_delete_transactions', 'bulk_delete_payees'];

// Tools whose delete path is optional: they require `finance:write` always and `finance:delete`
// only on the path that deletes, where the service decides and asks through a callback. Kept by
// hand, so a tool that sometimes deletes cannot ship with the write scope alone.
const CONDITIONAL_DELETE_TOOLS = [
  // With `force`, the service deletes the payee the ignored name resolves to; the handler checks
  // finance:delete before it calls the service.
  'ignore_payee_name',
  // The revert deletes the payment transaction the app created for the period; `revertPeriod` asks
  // `assertCanDeleteTransaction` inside its own transaction, right before `deleteTransaction`.
  'revert_subscription_period',
];

// Tools that check a scope but whose REST route carries no `checkBaseCurrencyLock`, so they
// skip `assertBaseCurrencyUnlocked`. Kept by hand, one route per entry: the lock follows the
// route, not the tool's name or scope. Add a tool here only after reading its route.
const LOCK_EXEMPT_TOOLS = [
  // POST /transactions/:transactionId/attachments has no lock: attachments touch no amounts.
  'create_attachment_upload_url',
  // GET /subscriptions/detect-candidates is a read in REST.
  'detect_subscription_candidates',
  // POST /user/currencies/:code/rate-source/test fetches one URL and saves nothing.
  'test_currency_rate_source',
  // POST /user/currencies/change-base has no lock: the enqueue takes its own NX lock. The tool is
  // exempt in that branch only; its first-base branch (POST /user/currencies/base) carries the
  // lock, so it is also in LOCK_EXEMPT_IN_ONE_BRANCH and calls it there.
  'change_base_currency',
  // DELETE /attachments/:id has no lock: attachments touch no amounts.
  'delete_attachment',
  // POST /notifications/read-all and POST /notifications/:id/read have no lock.
  'mark_notifications_read',
  // PUT and PATCH /user/settings have no lock: settings touch no amounts.
  'update_user_settings',
];

// Lock-exempt tools that still call `assertBaseCurrencyUnlocked` in one branch, because their
// branches follow two REST routes with different guards.
const LOCK_EXEMPT_IN_ONE_BRANCH = ['change_base_currency'];

// Read-named tools whose REST route carries `checkBaseCurrencyLock`, so REST refuses them with
// 423 during a base-currency change and the tool must too. They call no scope helper.
const LOCK_GUARDED_READ_TOOLS = [
  // POST /automations/preview
  'preview_transaction_automation',
  // POST /transactions/transfer-recommendations/bulk-scan: a scan that writes nothing
  'list_transfer_suggestions',
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

// Budget plan writes sit behind `requireFeature(FEATURES.budget_plan)` in REST, so every write tool
// on `/budget-plans` calls `requireFeatureAccess` for it. The one exception is kept by hand:
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

    const gate = 'requireFeatureAccess({ extra, feature: FEATURES.budget_plan })';
    const ungated = writes.filter((t) => !t.content.includes(gate)).map((t) => t.name);
    expect(ungated.toSorted()).toEqual(BUDGET_PLAN_UNGATED_TOOLS.toSorted());
  });
});
