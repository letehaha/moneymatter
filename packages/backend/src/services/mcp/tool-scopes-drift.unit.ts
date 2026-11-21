import { FEATURES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';

import { ALL_TOOLS } from './toolsets';

const READ_TOOL_NAME = /^(get|list|search|preview)_/;

// Tools that permanently delete a record without `delete_` in their name. Kept by
// hand: a new destructive tool named otherwise is only checked once it is listed here.
const DESTRUCTIVE_TOOLS = [
  'merge_payees',
  'bulk_delete_transactions',
  'bulk_delete_payees',
  'remove_duplicate_transactions',
];

// Tools whose delete path is optional: they require `finance:write` always and `finance:delete`
// only on the path that deletes. Kept by hand, so a tool that sometimes deletes cannot ship
// with the write scope alone.
const CONDITIONAL_DELETE_TOOLS = ['ignore_payee_name', 'revert_subscription_period'];

// Budget plan writes sit behind `requireFeature(FEATURES.budget_plan)` in REST. The one exception:
// `DELETE /budget-plans/:planId` is ungated, because an active plan blocks base-currency changes
// and a lapsed user must be able to drop it.
const BUDGET_PLAN_UNGATED_TOOLS = ['delete_budget_plan'];

const namesOf = ({ filter }: { filter: (def: (typeof ALL_TOOLS)[number]) => boolean }) =>
  ALL_TOOLS.filter(filter).map((def) => def.name);

describe('MCP tool scopes', () => {
  it('every read-named tool is a read, and every other tool needs a scope', () => {
    expect(namesOf({ filter: (def) => READ_TOOL_NAME.test(def.name) && def.access !== 'read' })).toEqual([]);
    expect(namesOf({ filter: (def) => !READ_TOOL_NAME.test(def.name) && def.access === 'read' })).toEqual([]);
  });

  it('every tool that permanently deletes a record requires finance:delete', () => {
    expect(ALL_TOOLS.map((def) => def.name)).toEqual(expect.arrayContaining(DESTRUCTIVE_TOOLS));

    const wrongScope = namesOf({
      filter: (def) =>
        (def.name.startsWith('delete_') || DESTRUCTIVE_TOOLS.includes(def.name)) && def.access !== 'delete',
    });
    expect(wrongScope).toEqual([]);
  });

  it('every goal write tool requires the goals feature', () => {
    const goalWrites = ALL_TOOLS.filter((def) => /^(create|update|delete)_goal$/.test(def.name));
    expect(goalWrites.map((def) => def.name).toSorted()).toEqual(['create_goal', 'delete_goal', 'update_goal']);

    expect(goalWrites.filter((def) => def.feature !== FEATURES.goals).map((def) => def.name)).toEqual([]);
  });

  it('every tool with an optional delete path requires finance:write and states the delete path', () => {
    expect(CONDITIONAL_DELETE_TOOLS.filter((name) => DESTRUCTIVE_TOOLS.includes(name))).toEqual([]);
    expect(namesOf({ filter: (def) => def.conditionalDelete !== undefined }).toSorted()).toEqual(
      CONDITIONAL_DELETE_TOOLS.toSorted(),
    );
    expect(namesOf({ filter: (def) => def.conditionalDelete !== undefined && def.access !== 'write' })).toEqual([]);
  });

  // `lock` is set only to override its default (`access !== 'read'`), with the REST route that
  // justifies it in a comment on the def.
  it('sets lock only to override its default', () => {
    expect(namesOf({ filter: (def) => def.lock !== undefined && def.lock === (def.access !== 'read') })).toEqual([]);
  });

  it('every budget plan write tool checks the budget_plan feature, except the ungated delete', () => {
    const writes = ALL_TOOLS.filter((def) => def.name.includes('budget_plan') && def.access !== 'read');
    expect(writes.length).toBeGreaterThan(0);

    const ungated = writes.filter((def) => def.feature !== FEATURES.budget_plan).map((def) => def.name);
    expect(ungated.toSorted()).toEqual(BUDGET_PLAN_UNGATED_TOOLS.toSorted());
  });

  it('a tool that unlinks records requires finance:write, because linking them again undoes it', () => {
    const unlinkTools = ALL_TOOLS.filter((def) => def.name.startsWith('unlink_'));
    expect(unlinkTools.map((def) => def.name)).toEqual(expect.arrayContaining(['unlink_refund', 'unlink_transfer']));

    expect(unlinkTools.filter((def) => def.access !== 'write').map((def) => def.name)).toEqual([]);
  });
});
