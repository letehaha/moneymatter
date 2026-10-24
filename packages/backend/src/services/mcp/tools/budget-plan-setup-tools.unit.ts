import { FEATURES, USER_ROLES } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundError } from '@js/errors';
import { createPlan } from '@services/budget-plans/create-plan';
import { deletePlan, purgePlan } from '@services/budget-plans/delete-plan';
import { createGroup, deleteGroup, updateGroup } from '@services/budget-plans/line-groups';
import { restorePlan } from '@services/budget-plans/restore-plan';
import { setPlanAccounts } from '@services/budget-plans/set-plan-accounts';
import { updatePlan } from '@services/budget-plans/update-plan';
import {
  createGroupBodyFields,
  createPlanBodyFields,
  createPlanBodySchema,
  restorePlanBodyFields,
  setPlanAccountsBodyFields,
  updateGroupBodyFields,
  updatePlanBodyFields,
  updatePlanBodySchema,
} from '@services/budget-plans/zod-schemas';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Block the real services, whose import chains build queues at module scope and would open
// Redis connections in a unit test.
jest.mock('@services/budget-plans/create-plan', () => ({ createPlan: jest.fn() }));
jest.mock('@services/budget-plans/update-plan', () => ({ updatePlan: jest.fn() }));
jest.mock('@services/budget-plans/delete-plan', () => ({ deletePlan: jest.fn(), purgePlan: jest.fn() }));
jest.mock('@services/budget-plans/restore-plan', () => ({ restorePlan: jest.fn() }));
jest.mock('@services/budget-plans/set-plan-accounts', () => ({ setPlanAccounts: jest.fn() }));
jest.mock('@services/budget-plans/line-groups', () => ({
  createGroup: jest.fn(),
  updateGroup: jest.fn(),
  deleteGroup: jest.fn(),
}));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { registerCreateBudgetPlan } from './create-budget-plan';
import { registerCreateBudgetPlanGroup } from './create-budget-plan-group';
import { registerDeleteBudgetPlan } from './delete-budget-plan';
import { registerDeleteBudgetPlanGroup } from './delete-budget-plan-group';
import { registerRestoreBudgetPlan } from './restore-budget-plan';
import { registerSetBudgetPlanAccounts } from './set-budget-plan-accounts';
import { registerUpdateBudgetPlan } from './update-budget-plan';
import { registerUpdateBudgetPlanGroup } from './update-budget-plan-group';

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const GROUP_ID = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ACCOUNT_ID = '44444444-4444-4444-8444-444444444444';
const LINE_ID = '55555555-5555-4555-8555-555555555555';

const WITH_PLAN = makeExtra({ features: [FEATURES.budget_plan] });
// A lapsed plan: the user holds the delete scope but not the budget plan feature.
const DELETE_ONLY_NO_PLAN = makeExtra({ scopes: ['finance:read', 'finance:delete'], features: [] });
const WRITE_ONLY = makeExtra({ scopes: ['finance:read', 'finance:write'], features: [FEATURES.budget_plan] });

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const createPlanService = jest.mocked(createPlan);
const updatePlanService = jest.mocked(updatePlan);
const deletePlanService = jest.mocked(deletePlan);
const purgePlanService = jest.mocked(purgePlan);
const restorePlanService = jest.mocked(restorePlan);
const setPlanAccountsService = jest.mocked(setPlanAccounts);
const createGroupService = jest.mocked(createGroup);
const updateGroupService = jest.mocked(updateGroup);
const deleteGroupService = jest.mocked(deleteGroup);

const call = async ({
  tool,
  args,
  extra = WITH_PLAN,
}: {
  tool: ReturnType<typeof captureTools>[number];
  args?: unknown;
  extra?: ReturnType<typeof makeExtra>;
}) => parseToolResult({ result: await (args === undefined ? tool.handler(extra) : tool.handler(args, extra)) });

/** The plan as `getPlan` returns it: the plain row, with the owner id and audit timestamps, income as a decimal. */
const makePlanRow = (patch: Record<string, unknown> = {}) => ({
  id: PLAN_ID,
  userId: 42,
  name: 'Household',
  type: 'category_caps',
  currencyCode: 'USD',
  cadence: 'months',
  intervalN: 1,
  anchorDate: '2026-01-01',
  secondAnchorDay: null,
  epochDate: '2026-01-01',
  carryPolicy: 'floor',
  autoAttachAccounts: true,
  poolFrom: null,
  zeroSum: false,
  expectedIncome: 3_500.25,
  createdAt: new Date('2026-01-01T08:00:00.000Z'),
  updatedAt: new Date('2026-02-01T08:00:00.000Z'),
  deletedAt: null,
  ...patch,
});

const makeDetails = (planPatch: Record<string, unknown> = {}) => ({
  plan: makePlanRow(planPatch),
  accountIds: [ACCOUNT_ID],
  lines: [
    {
      id: LINE_ID,
      name: 'Groceries',
      sortOrder: 0,
      groupId: null,
      activeFrom: '2026-01-01',
      activeUntil: null,
      categoryIds: [],
    },
  ],
});

/** What an assistant sees of that plan: no owner id and no audit timestamps. */
const presentedDetails = (planPatch: Record<string, unknown> = {}) => ({
  plan: {
    id: PLAN_ID,
    name: 'Household',
    type: 'category_caps',
    currencyCode: 'USD',
    cadence: 'months',
    intervalN: 1,
    anchorDate: '2026-01-01',
    secondAnchorDay: null,
    epochDate: '2026-01-01',
    carryPolicy: 'floor',
    autoAttachAccounts: true,
    poolFrom: null,
    zeroSum: false,
    expectedIncome: 3_500.25,
    deletedAt: null,
    ...planPatch,
  },
  accountIds: [ACCOUNT_ID],
  lines: makeDetails().lines,
});

const VALID_CREATE = {
  name: 'Household',
  type: 'category_caps',
  cadence: 'months',
  anchorDate: '2026-01-01',
  accountIds: [ACCOUNT_ID],
};

beforeEach(() => {
  jest.resetAllMocks();
  lockCheck.mockResolvedValue(false);
});

describe('create_budget_plan', () => {
  const tool = captureTools({ register: registerCreateBudgetPlan })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name with every field of the REST body', () => {
    expect(tool.name).toBe('create_budget_plan');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(Object.keys(createPlanBodyFields).toSorted());
    expect(Object.keys(createPlanBodyFields).length).toBeGreaterThan(10);
  });

  it('applies the REST validation', () => {
    expect(schema.safeParse(VALID_CREATE).success).toBe(true);
    expect(
      schema.safeParse({
        ...VALID_CREATE,
        cadence: 'semi_monthly',
        intervalN: 1,
        secondAnchorDay: 15,
        epochDate: '2025-12-01',
        autoAttachAccounts: false,
        carryPolicy: 'signed',
        poolEnabled: true,
        withSuggestedLines: true,
        suggestionAnswers: { detail: 'compact', focusCategoryIds: [LINE_ID] },
      }).success,
    ).toBe(true);

    const invalid: Record<string, unknown>[] = [
      { name: undefined },
      { name: '   ' },
      { name: 'x'.repeat(201) },
      { type: 'envelopes' },
      { cadence: 'weekly' },
      { intervalN: 0 },
      { intervalN: 1.5 },
      { anchorDate: '2026-02-30' },
      { anchorDate: '01/01/2026' },
      { secondAnchorDay: 0 },
      { secondAnchorDay: 32 },
      { epochDate: 'yesterday' },
      { accountIds: undefined },
      { accountIds: [] },
      { accountIds: ['nope'] },
      { accountIds: [ACCOUNT_ID, ACCOUNT_ID] },
      { carryPolicy: 'hoard' },
      { poolEnabled: 'yes' },
      { suggestionAnswers: { detail: 'whatever' } },
      { suggestionAnswers: { unknownKey: 1 } },
    ];
    for (const patch of invalid) {
      expect([patch, schema.safeParse({ ...VALID_CREATE, ...patch }).success]).toEqual([patch, false]);
    }
    expect(schema.safeParse({ ...VALID_CREATE, ownerId: 1 }).success).toBe(false);
  });

  it('keeps the REST body schema strict, with the same fields', () => {
    expect(createPlanBodySchema.safeParse(VALID_CREATE).success).toBe(true);
    expect(createPlanBodySchema.safeParse({ ...VALID_CREATE, extra: 1 }).success).toBe(false);
  });

  it('creates the plan for the caller and returns it slimmed', async () => {
    createPlanService.mockResolvedValue(makeDetails() as never);

    const data = await call({ tool, args: { ...VALID_CREATE, name: ' Household ', carryPolicy: 'floor' } });

    expect(createPlanService).toHaveBeenCalledTimes(1);
    expect(createPlanService).toHaveBeenCalledWith({
      userId: 42,
      ...VALID_CREATE,
      name: 'Household',
      carryPolicy: 'floor',
    });
    expect(data).toEqual(presentedDetails());
    expect(data).not.toHaveProperty('plan.userId');
    expect(data).not.toHaveProperty('plan.createdAt');
  });

  it('reports when the suggested lines failed or the answers were ignored', async () => {
    createPlanService.mockResolvedValue({ ...makeDetails(), suggestedLinesFailed: true } as never);
    expect(await call({ tool, args: { ...VALID_CREATE, withSuggestedLines: true } })).toEqual({
      ...presentedDetails(),
      suggestedLinesFailed: true,
    });

    createPlanService.mockResolvedValue({ ...makeDetails(), suggestionAnswersIgnored: true } as never);
    expect(await call({ tool, args: { ...VALID_CREATE, withSuggestedLines: true } })).toEqual({
      ...presentedDetails(),
      suggestionAnswersIgnored: true,
    });
  });

  it('passes the service refusals through, scoped to the caller', async () => {
    createPlanService.mockRejectedValue(new NotFoundError({ message: 'Account not found' }));

    await expect(
      call({ tool, args: VALID_CREATE, extra: makeExtra({ userId: 7, features: [FEATURES.budget_plan] }) }),
    ).rejects.toThrow('Account not found');
    expect(createPlanService).toHaveBeenCalledWith(expect.objectContaining({ userId: 7 }));
  });

  it('says what a plan is and that only one can be active', () => {
    expect(tool.config.description).toMatch(/one (active )?plan|only one/i);
    expect(tool.config.description).toMatch(/list_budget_plans/);
  });
});

describe('update_budget_plan', () => {
  const tool = captureTools({ register: registerUpdateBudgetPlan })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name with the plan id and every field of the REST patch', () => {
    expect(tool.name).toBe('update_budget_plan');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      ['planId', ...Object.keys(updatePlanBodyFields)].toSorted(),
    );
    expect(Object.keys(updatePlanBodyFields).toSorted()).toEqual([
      'autoAttachAccounts',
      'carryPolicy',
      'expectedIncome',
      'name',
      'poolEnabled',
      'zeroSum',
    ]);
  });

  it('applies the REST validation, with the plan id required', () => {
    expect(schema.safeParse({ planId: PLAN_ID }).success).toBe(true);
    expect(
      schema.safeParse({
        planId: PLAN_ID,
        name: 'Home',
        autoAttachAccounts: false,
        carryPolicy: 'none',
        poolEnabled: true,
        zeroSum: true,
        expectedIncome: 4_000.5,
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ planId: PLAN_ID, expectedIncome: null }).success).toBe(true);

    const invalid: Record<string, unknown>[] = [
      { planId: undefined },
      { planId: 'nope' },
      { name: '' },
      { carryPolicy: 'hoard' },
      { zeroSum: 'yes' },
      { expectedIncome: -1 },
      { expectedIncome: 1e14 },
      // cadence, anchor, epoch and type are immutable
      { cadence: 'days' },
      { anchorDate: '2026-02-01' },
      { epochDate: '2026-02-01' },
      { type: 'category_caps' },
    ];
    for (const patch of invalid) {
      const input = { planId: PLAN_ID, ...patch };
      expect([patch, schema.safeParse(input).success]).toEqual([patch, false]);
    }
    expect(updatePlanBodySchema.safeParse({ cadence: 'days' }).success).toBe(false);
  });

  it('updates the caller plan with the given fields only and returns it slimmed', async () => {
    updatePlanService.mockResolvedValue(makeDetails({ name: 'Home', zeroSum: true }) as never);

    const data = await call({ tool, args: { planId: PLAN_ID, name: 'Home', zeroSum: true } });

    expect(updatePlanService).toHaveBeenCalledWith({ userId: 42, planId: PLAN_ID, name: 'Home', zeroSum: true });
    expect(data).toEqual(presentedDetails({ name: 'Home', zeroSum: true }));
  });

  it('passes a cleared expected income through as null', async () => {
    updatePlanService.mockResolvedValue(makeDetails({ expectedIncome: null }) as never);

    const data = await call({ tool, args: { planId: PLAN_ID, expectedIncome: null } });

    expect(updatePlanService).toHaveBeenCalledWith({ userId: 42, planId: PLAN_ID, expectedIncome: null });
    expect(data).toEqual(presentedDetails({ expectedIncome: null }));
  });

  it("passes another user's plan through as the service not-found error, scoped to the caller", async () => {
    updatePlanService.mockRejectedValue(new NotFoundError({ message: 'Budget plan not found' }));

    await expect(
      call({
        tool,
        args: { planId: PLAN_ID, name: 'Home' },
        extra: makeExtra({ userId: 7, features: [FEATURES.budget_plan] }),
      }),
    ).rejects.toThrow('Budget plan not found');
    expect(updatePlanService).toHaveBeenCalledWith({ userId: 7, planId: PLAN_ID, name: 'Home' });
  });
});

describe('delete_budget_plan', () => {
  const tool = captureTools({ register: registerDeleteBudgetPlan })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name with the plan id and permanent', () => {
    expect(tool.name).toBe('delete_budget_plan');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['planId', 'permanent']);
    expect(schema.safeParse({ planId: PLAN_ID }).success).toBe(true);
    expect(schema.safeParse({ planId: PLAN_ID, permanent: true }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ planId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ planId: PLAN_ID, permanent: 'yes' }).success).toBe(false);
  });

  it('moves the plan to the trash by default', async () => {
    const data = await call({ tool, args: { planId: PLAN_ID } });

    expect(deletePlanService).toHaveBeenCalledWith({ userId: 42, planId: PLAN_ID });
    expect(purgePlanService).not.toHaveBeenCalled();
    expect(data).toEqual({ deleted: true, id: PLAN_ID, permanent: false });
  });

  it('purges a plan that is already in the trash when permanent is true', async () => {
    const data = await call({ tool, args: { planId: PLAN_ID, permanent: true } });

    expect(purgePlanService).toHaveBeenCalledWith({ userId: 42, planId: PLAN_ID });
    expect(deletePlanService).not.toHaveBeenCalled();
    expect(data).toEqual({ deleted: true, id: PLAN_ID, permanent: true });
  });

  it('treats permanent: false as a soft delete', async () => {
    await call({ tool, args: { planId: PLAN_ID, permanent: false } });

    expect(deletePlanService).toHaveBeenCalledTimes(1);
    expect(purgePlanService).not.toHaveBeenCalled();
  });

  it('is not feature-gated: a user without the plan feature can still delete', async () => {
    await call({ tool, args: { planId: PLAN_ID }, extra: DELETE_ONLY_NO_PLAN });

    expect(deletePlanService).toHaveBeenCalledWith({ userId: 42, planId: PLAN_ID });
  });

  it('needs the delete scope, not the write scope', async () => {
    await expect(call({ tool, args: { planId: PLAN_ID }, extra: WRITE_ONLY })).rejects.toThrow(
      /Missing required scope: finance:delete/,
    );
    expect(deletePlanService).not.toHaveBeenCalled();
  });

  it("passes another user's plan through as the service not-found error, scoped to the caller", async () => {
    purgePlanService.mockRejectedValue(new NotFoundError({ message: 'Budget plan not found' }));

    await expect(
      call({ tool, args: { planId: PLAN_ID, permanent: true }, extra: makeExtra({ userId: 7 }) }),
    ).rejects.toThrow('Budget plan not found');
    expect(purgePlanService).toHaveBeenCalledWith({ userId: 7, planId: PLAN_ID });
  });

  it('warns that the trash is the only way back and that permanent needs a trashed plan', () => {
    expect(tool.config.description).toMatch(/restore_budget_plan/);
    expect(tool.config.description).toMatch(/trash/i);
    expect(tool.config.description).toMatch(/irreversible|cannot be undone/i);
  });
});

describe('restore_budget_plan', () => {
  const tool = captureTools({ register: registerRestoreBudgetPlan })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name with the plan id and every field of the REST body', () => {
    expect(tool.name).toBe('restore_budget_plan');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      ['planId', ...Object.keys(restorePlanBodyFields)].toSorted(),
    );
    expect(Object.keys(restorePlanBodyFields)).toEqual(['replace']);
    expect(schema.safeParse({ planId: PLAN_ID }).success).toBe(true);
    expect(schema.safeParse({ planId: PLAN_ID, replace: true }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ planId: PLAN_ID, replace: 'yes' }).success).toBe(false);
  });

  it('restores the caller plan and returns it slimmed', async () => {
    restorePlanService.mockResolvedValue(makeDetails() as never);

    const data = await call({ tool, args: { planId: PLAN_ID } });

    expect(restorePlanService).toHaveBeenCalledWith({ userId: 42, planId: PLAN_ID, replace: undefined });
    expect(data).toEqual(presentedDetails());
  });

  it('passes replace through so the active plan goes to the trash', async () => {
    restorePlanService.mockResolvedValue(makeDetails() as never);

    await call({ tool, args: { planId: PLAN_ID, replace: true } });

    expect(restorePlanService).toHaveBeenCalledWith({ userId: 42, planId: PLAN_ID, replace: true });
  });

  it("passes another user's plan through as the service not-found error, scoped to the caller", async () => {
    restorePlanService.mockRejectedValue(new NotFoundError({ message: 'Budget plan not found' }));

    await expect(
      call({ tool, args: { planId: PLAN_ID }, extra: makeExtra({ userId: 7, features: [FEATURES.budget_plan] }) }),
    ).rejects.toThrow('Budget plan not found');
    expect(restorePlanService).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, planId: PLAN_ID }));
  });
});

describe('set_budget_plan_accounts', () => {
  const tool = captureTools({ register: registerSetBudgetPlanAccounts })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name with the plan id and the REST account list', () => {
    expect(tool.name).toBe('set_budget_plan_accounts');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      ['planId', ...Object.keys(setPlanAccountsBodyFields)].toSorted(),
    );
    expect(Object.keys(setPlanAccountsBodyFields)).toEqual(['accountIds']);
  });

  it('applies the REST validation: unique ids, an empty set allowed', () => {
    expect(schema.safeParse({ planId: PLAN_ID, accountIds: [ACCOUNT_ID, OTHER_ACCOUNT_ID] }).success).toBe(true);
    expect(schema.safeParse({ planId: PLAN_ID, accountIds: [] }).success).toBe(true);
    expect(schema.safeParse({ planId: PLAN_ID }).success).toBe(false);
    expect(schema.safeParse({ accountIds: [ACCOUNT_ID] }).success).toBe(false);
    expect(schema.safeParse({ planId: PLAN_ID, accountIds: [ACCOUNT_ID, ACCOUNT_ID] }).success).toBe(false);
    expect(schema.safeParse({ planId: PLAN_ID, accountIds: ['nope'] }).success).toBe(false);
  });

  it('replaces the account set of the caller plan and returns it slimmed', async () => {
    setPlanAccountsService.mockResolvedValue(makeDetails() as never);

    const data = await call({ tool, args: { planId: PLAN_ID, accountIds: [ACCOUNT_ID] } });

    expect(setPlanAccountsService).toHaveBeenCalledWith({ userId: 42, planId: PLAN_ID, accountIds: [ACCOUNT_ID] });
    expect(data).toEqual(presentedDetails());
  });

  it('passes an account the caller does not own through as the service refusal, scoped to the caller', async () => {
    setPlanAccountsService.mockRejectedValue(new NotFoundError({ message: 'Account not found' }));

    await expect(
      call({
        tool,
        args: { planId: PLAN_ID, accountIds: [OTHER_ACCOUNT_ID] },
        extra: makeExtra({ userId: 7, features: [FEATURES.budget_plan] }),
      }),
    ).rejects.toThrow('Account not found');
    expect(setPlanAccountsService).toHaveBeenCalledWith({ userId: 7, planId: PLAN_ID, accountIds: [OTHER_ACCOUNT_ID] });
  });
});

describe('create_budget_plan_group', () => {
  const tool = captureTools({ register: registerCreateBudgetPlanGroup })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name with the plan id and the REST group fields', () => {
    expect(tool.name).toBe('create_budget_plan_group');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      ['planId', ...Object.keys(createGroupBodyFields)].toSorted(),
    );
    expect(Object.keys(createGroupBodyFields)).toEqual(['name']);
    expect(schema.safeParse({ planId: PLAN_ID, name: 'Fixed costs' }).success).toBe(true);
    expect(schema.safeParse({ planId: PLAN_ID, name: '  ' }).success).toBe(false);
    expect(schema.safeParse({ planId: PLAN_ID, name: 'x'.repeat(201) }).success).toBe(false);
    expect(schema.safeParse({ name: 'Fixed costs' }).success).toBe(false);
    expect(schema.safeParse({ planId: PLAN_ID }).success).toBe(false);
  });

  it('creates the group in the caller plan with the trimmed name', async () => {
    createGroupService.mockResolvedValue({ id: GROUP_ID, name: 'Fixed costs', sortOrder: 0 } as never);

    const data = await call({ tool, args: { planId: PLAN_ID, name: ' Fixed costs ' } });

    expect(createGroupService).toHaveBeenCalledWith({ userId: 42, planId: PLAN_ID, name: 'Fixed costs' });
    expect(data).toEqual({ id: GROUP_ID, name: 'Fixed costs', sortOrder: 0 });
  });

  it("passes another user's plan through as the service not-found error, scoped to the caller", async () => {
    createGroupService.mockRejectedValue(new NotFoundError({ message: 'Budget plan not found' }));

    await expect(
      call({
        tool,
        args: { planId: PLAN_ID, name: 'Fixed' },
        extra: makeExtra({ userId: 7, features: [FEATURES.budget_plan] }),
      }),
    ).rejects.toThrow('Budget plan not found');
    expect(createGroupService).toHaveBeenCalledWith({ userId: 7, planId: PLAN_ID, name: 'Fixed' });
  });
});

describe('update_budget_plan_group', () => {
  const tool = captureTools({ register: registerUpdateBudgetPlanGroup })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name with the plan id, the group id and the REST group fields', () => {
    expect(tool.name).toBe('update_budget_plan_group');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      ['groupId', 'planId', ...Object.keys(updateGroupBodyFields)].toSorted(),
    );
    expect(schema.safeParse({ planId: PLAN_ID, groupId: GROUP_ID, name: 'Fixed' }).success).toBe(true);
    expect(schema.safeParse({ planId: PLAN_ID, name: 'Fixed' }).success).toBe(false);
    expect(schema.safeParse({ planId: PLAN_ID, groupId: GROUP_ID }).success).toBe(false);
    expect(schema.safeParse({ planId: PLAN_ID, groupId: GROUP_ID, name: '' }).success).toBe(false);
    expect(schema.safeParse({ planId: PLAN_ID, groupId: 'nope', name: 'Fixed' }).success).toBe(false);
  });

  it('renames the group of the caller plan', async () => {
    updateGroupService.mockResolvedValue({ id: GROUP_ID, name: 'Fixed', sortOrder: 2 } as never);

    const data = await call({ tool, args: { planId: PLAN_ID, groupId: GROUP_ID, name: 'Fixed' } });

    expect(updateGroupService).toHaveBeenCalledWith({ userId: 42, planId: PLAN_ID, groupId: GROUP_ID, name: 'Fixed' });
    expect(data).toEqual({ id: GROUP_ID, name: 'Fixed', sortOrder: 2 });
  });

  it("passes another user's group through as the service not-found error, scoped to the caller", async () => {
    updateGroupService.mockRejectedValue(new NotFoundError({ message: 'Group not found' }));

    await expect(
      call({
        tool,
        args: { planId: PLAN_ID, groupId: GROUP_ID, name: 'Fixed' },
        extra: makeExtra({ userId: 7, features: [FEATURES.budget_plan] }),
      }),
    ).rejects.toThrow('Group not found');
    expect(updateGroupService).toHaveBeenCalledWith({ userId: 7, planId: PLAN_ID, groupId: GROUP_ID, name: 'Fixed' });
  });
});

describe('delete_budget_plan_group', () => {
  const tool = captureTools({ register: registerDeleteBudgetPlanGroup })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name with the plan id and the group id', () => {
    expect(tool.name).toBe('delete_budget_plan_group');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(['groupId', 'planId']);
    expect(schema.safeParse({ planId: PLAN_ID, groupId: GROUP_ID }).success).toBe(true);
    expect(schema.safeParse({ planId: PLAN_ID }).success).toBe(false);
    expect(schema.safeParse({ groupId: GROUP_ID }).success).toBe(false);
  });

  it('deletes the group of the caller plan, needing the delete scope and the plan feature', async () => {
    const data = await call({ tool, args: { planId: PLAN_ID, groupId: GROUP_ID } });

    expect(deleteGroupService).toHaveBeenCalledWith({ userId: 42, planId: PLAN_ID, groupId: GROUP_ID });
    expect(data).toEqual({ deleted: true, id: GROUP_ID, planId: PLAN_ID });

    await expect(call({ tool, args: { planId: PLAN_ID, groupId: GROUP_ID }, extra: WRITE_ONLY })).rejects.toThrow(
      /Missing required scope: finance:delete/,
    );
  });

  it('passes a refusal for a group that still holds lines through', async () => {
    deleteGroupService.mockRejectedValue(new Error('budgetPlans.groupNotEmpty'));

    await expect(call({ tool, args: { planId: PLAN_ID, groupId: GROUP_ID } })).rejects.toThrow(
      'budgetPlans.groupNotEmpty',
    );
  });
});

const GROUP = { id: GROUP_ID, name: 'Fixed', sortOrder: 0 };

const SETUP_TOOLS = [
  {
    register: registerCreateBudgetPlan,
    name: 'create_budget_plan',
    result: makeDetails(),
    args: VALID_CREATE,
    service: createPlanService,
    scopes: ['finance:read', 'finance:write'],
    gated: true,
  },
  {
    register: registerUpdateBudgetPlan,
    name: 'update_budget_plan',
    result: makeDetails(),
    args: { planId: PLAN_ID, name: 'Home' },
    service: updatePlanService,
    scopes: ['finance:read', 'finance:write'],
    gated: true,
  },
  {
    register: registerDeleteBudgetPlan,
    name: 'delete_budget_plan',
    result: undefined,
    args: { planId: PLAN_ID },
    service: deletePlanService,
    scopes: ['finance:read', 'finance:delete'],
    gated: false,
  },
  {
    register: registerRestoreBudgetPlan,
    name: 'restore_budget_plan',
    result: makeDetails(),
    args: { planId: PLAN_ID },
    service: restorePlanService,
    scopes: ['finance:read', 'finance:write'],
    gated: true,
  },
  {
    register: registerSetBudgetPlanAccounts,
    name: 'set_budget_plan_accounts',
    result: makeDetails(),
    args: { planId: PLAN_ID, accountIds: [ACCOUNT_ID] },
    service: setPlanAccountsService,
    scopes: ['finance:read', 'finance:write'],
    gated: true,
  },
  {
    register: registerCreateBudgetPlanGroup,
    name: 'create_budget_plan_group',
    result: GROUP,
    args: { planId: PLAN_ID, name: 'Fixed' },
    service: createGroupService,
    scopes: ['finance:read', 'finance:write'],
    gated: true,
  },
  {
    register: registerUpdateBudgetPlanGroup,
    name: 'update_budget_plan_group',
    result: GROUP,
    args: { planId: PLAN_ID, groupId: GROUP_ID, name: 'Fixed' },
    service: updateGroupService,
    scopes: ['finance:read', 'finance:write'],
    gated: true,
  },
  {
    register: registerDeleteBudgetPlanGroup,
    name: 'delete_budget_plan_group',
    result: undefined,
    args: { planId: PLAN_ID, groupId: GROUP_ID },
    service: deleteGroupService,
    scopes: ['finance:read', 'finance:delete'],
    gated: true,
  },
];

describe.each(SETUP_TOOLS)('$name write guards', ({ register, name, args, service, scopes, gated, result }) => {
  const tool = captureTools({ register }).find((candidate) => candidate.name === name)!;
  const ok = makeExtra({ scopes, features: [FEATURES.budget_plan] });

  it('is refused while the base-currency lock is set, with the service not called', async () => {
    lockCheck.mockResolvedValueOnce(true);

    await expect(tool.handler(args, ok)).rejects.toThrow(/currencies.baseCurrencyChangeInProgress/);
    expect(service).not.toHaveBeenCalled();
  });

  it('is refused for a demo user, with the service not called', async () => {
    await expect(
      tool.handler(args, makeExtra({ scopes, role: USER_ROLES.demo, features: [FEATURES.budget_plan] })),
    ).rejects.toThrow(/demo mode/);
    expect(service).not.toHaveBeenCalled();
  });

  it('is refused for a read-only user, with the service not called', async () => {
    await expect(
      tool.handler(args, makeExtra({ scopes, readOnly: true, features: [FEATURES.budget_plan] })),
    ).rejects.toThrow(/no longer includes editing/);
    expect(service).not.toHaveBeenCalled();
  });

  it('is refused without its scope, with the service not called', async () => {
    await expect(
      tool.handler(args, makeExtra({ scopes: ['finance:read'], features: [FEATURES.budget_plan] })),
    ).rejects.toThrow(/Missing required scope/);
    expect(service).not.toHaveBeenCalled();
  });

  if (gated) {
    it('is refused without the budget plan feature, with the service not called', async () => {
      await expect(tool.handler(args, makeExtra({ scopes, features: [] }))).rejects.toThrow(
        /not included in your current plan/,
      );
      expect(service).not.toHaveBeenCalled();
    });

    it('is refused when the plan carries other features only', async () => {
      await expect(tool.handler(args, makeExtra({ scopes, features: [FEATURES.attachments] }))).rejects.toThrow(
        /not included in your current plan/,
      );
      expect(service).not.toHaveBeenCalled();
    });

    it('checks the scope before the feature', async () => {
      await expect(tool.handler(args, makeExtra({ scopes: ['finance:read'], features: [] }))).rejects.toThrow(
        /Missing required scope/,
      );
    });
  } else {
    it('runs without the budget plan feature', async () => {
      await tool.handler(args, makeExtra({ scopes, features: [] }));

      expect(service).toHaveBeenCalledTimes(1);
    });
  }

  it('runs with the budget plan feature and a free lock', async () => {
    service.mockResolvedValue(result as never);
    await tool.handler(args, ok);

    expect(service).toHaveBeenCalledTimes(1);
  });
});
