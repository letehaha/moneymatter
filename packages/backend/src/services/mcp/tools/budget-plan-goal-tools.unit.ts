import { BUDGET_ASSIGNMENT_SCOPES, BUDGET_PLAN_CARRY_POLICIES, FEATURES, USER_ROLES } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundError, ValidationError } from '@js/errors';
import { lineGoalSchema } from '@services/budget-plans/line-goal-schema';
import { deleteLineGoal, setLineGoal, snoozeLineGoal } from '@services/budget-plans/line-goals';
import { setAssignment } from '@services/budget-plans/set-assignment';
import { setAssignmentBodyFields, setAssignmentBodySchema } from '@services/budget-plans/zod-schemas';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Block the real services, whose import chains build queues at module scope and would open
// Redis connections in a unit test.
jest.mock('@services/budget-plans/line-goals', () => ({
  setLineGoal: jest.fn(),
  deleteLineGoal: jest.fn(),
  snoozeLineGoal: jest.fn(),
}));
jest.mock('@services/budget-plans/set-assignment', () => ({ setAssignment: jest.fn() }));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { registerDeleteBudgetPlanLineGoal } from './delete-budget-plan-line-goal';
import { registerSetBudgetPlanAssignment } from './set-budget-plan-assignment';
import { registerSetBudgetPlanLineGoal } from './set-budget-plan-line-goal';
import { registerSnoozeBudgetPlanLineGoal } from './snooze-budget-plan-line-goal';

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const PERIOD_ID = '22222222-2222-4222-8222-222222222222';
const LINE_ID = '55555555-5555-4555-8555-555555555555';
const PAST = '2020-01-15';
const FUTURE = '2099-06-15';

const WITH_PLAN = makeExtra({ features: [FEATURES.budget_plan] });

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const setLineGoalService = jest.mocked(setLineGoal);
const deleteLineGoalService = jest.mocked(deleteLineGoal);
const snoozeLineGoalService = jest.mocked(snoozeLineGoal);
const setAssignmentService = jest.mocked(setAssignment);

const call = async ({
  tool,
  args,
  extra = WITH_PLAN,
}: {
  tool: ReturnType<typeof captureTools>[number];
  args: unknown;
  extra?: ReturnType<typeof makeExtra>;
}) => parseToolResult({ result: await tool.handler(args, extra) });

const GOAL_ENTRY = {
  frequency: 'every_period',
  behavior: 'budget_another',
  amount: 100,
  weekday: null,
  anchorDate: null,
  repeatEvery: null,
  repeatUnit: null,
  stopAtBalance: null,
  fundingCap: null,
};

beforeEach(() => {
  jest.resetAllMocks();
  lockCheck.mockResolvedValue(false);
});

describe('set_budget_plan_line_goal', () => {
  const tool = captureTools({ register: registerSetBudgetPlanLineGoal })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();
  const base = { planId: PLAN_ID, lineId: LINE_ID };
  const goal = { frequency: 'every_period', behavior: 'budget_another', amount: 100 };

  it('registers under its name with both ids and every field of the REST goal body, as a plain shape', () => {
    expect(tool.name).toBe('set_budget_plan_line_goal');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      ['lineId', 'planId', ...Object.keys(lineGoalSchema.shape)].toSorted(),
    );
    expect(Object.keys(lineGoalSchema.shape).toSorted()).toEqual([
      'amount',
      'anchorDate',
      'behavior',
      'frequency',
      'fundingCap',
      'periodId',
      'repeatEvery',
      'repeatUnit',
      'stopAtBalance',
      'weekday',
    ]);
  });

  it('applies the per-field REST validation, with both ids required', () => {
    expect(schema.safeParse({ ...base, ...goal }).success).toBe(true);
    expect(
      schema.safeParse({
        ...base,
        frequency: 'by_date',
        behavior: 'refill_up_to',
        amount: 10.5,
        anchorDate: FUTURE,
        repeatEvery: 2,
        repeatUnit: 'months',
        fundingCap: 50,
        periodId: PERIOD_ID,
      }).success,
    ).toBe(true);

    const invalid: Record<string, unknown>[] = [
      { planId: undefined },
      { lineId: undefined },
      { lineId: 'nope' },
      { frequency: undefined },
      { frequency: 'monthly' },
      { behavior: undefined },
      { behavior: 'whatever' },
      { amount: undefined },
      { amount: 0 },
      { amount: -5 },
      { weekday: 7 },
      { weekday: 1.5 },
      { anchorDate: '2026-02-30' },
      { repeatEvery: 0 },
      { repeatUnit: 'days' },
      { stopAtBalance: 0 },
      { fundingCap: -1 },
      { periodId: 'nope' },
      { unknownField: 1 },
    ];
    for (const patch of invalid) {
      expect([patch, schema.safeParse({ ...base, ...goal, ...patch }).success]).toEqual([patch, false]);
    }
  });

  it('keeps the REST goal schema strict and refined', () => {
    expect(lineGoalSchema.safeParse(goal).success).toBe(true);
    expect(lineGoalSchema.safeParse({ ...goal, planId: PLAN_ID }).success).toBe(false);
    expect(lineGoalSchema.safeParse({ ...goal, behavior: 'reach_balance' }).success).toBe(false);
  });

  it('saves a normal goal for the caller, passing the goal fields only and the ids beside them', async () => {
    setLineGoalService.mockResolvedValue(GOAL_ENTRY as never);

    const data = await call({ tool, args: { ...base, ...goal } });

    expect(setLineGoalService).toHaveBeenCalledTimes(1);
    expect(setLineGoalService).toHaveBeenCalledWith({
      userId: 42,
      planId: PLAN_ID,
      lineId: LINE_ID,
      frequency: 'every_period',
      behavior: 'budget_another',
      amount: 100,
    });
    expect(data).toEqual(GOAL_ENTRY);
  });

  it('passes the optional fields and a null through to the service', async () => {
    setLineGoalService.mockResolvedValue(GOAL_ENTRY as never);

    await call({
      tool,
      args: {
        ...base,
        frequency: 'by_date',
        behavior: 'refill_up_to',
        amount: 80,
        anchorDate: FUTURE,
        repeatEvery: 3,
        repeatUnit: 'months',
        fundingCap: 200,
        stopAtBalance: null,
        periodId: PERIOD_ID,
      },
    });

    expect(setLineGoalService).toHaveBeenCalledWith({
      userId: 42,
      planId: PLAN_ID,
      lineId: LINE_ID,
      frequency: 'by_date',
      behavior: 'refill_up_to',
      amount: 80,
      anchorDate: FUTURE,
      repeatEvery: 3,
      repeatUnit: 'months',
      fundingCap: 200,
      stopAtBalance: null,
      periodId: PERIOD_ID,
    });
  });

  describe('refinements, per frequency, enforced in the handler with the service not called', () => {
    const allowed: [string, Record<string, unknown>][] = [
      ['every_period', { frequency: 'every_period', behavior: 'refill_up_to', amount: 10 }],
      ['weekly', { frequency: 'weekly', behavior: 'budget_another', amount: 10, weekday: 1 }],
      ['biweekly', { frequency: 'biweekly', behavior: 'budget_another', amount: 10, anchorDate: PAST }],
      ['yearly', { frequency: 'yearly', behavior: 'refill_up_to', amount: 10, anchorDate: FUTURE }],
      ['by_date', { frequency: 'by_date', behavior: 'reach_balance', amount: 10, anchorDate: FUTURE }],
      ['open_ended', { frequency: 'open_ended', behavior: 'reach_balance', amount: 10 }],
    ];
    const refused: [string, Record<string, unknown>, RegExp][] = [
      [
        'every_period with reach_balance',
        { frequency: 'every_period', behavior: 'reach_balance', amount: 10 },
        /A every_period goal cannot use reach_balance/,
      ],
      [
        'weekly without a weekday',
        { frequency: 'weekly', behavior: 'budget_another', amount: 10 },
        /A weekly goal needs a weekday/,
      ],
      [
        'biweekly without an anchor date',
        { frequency: 'biweekly', behavior: 'budget_another', amount: 10 },
        /A biweekly goal needs an anchor date/,
      ],
      [
        'yearly with reach_balance',
        { frequency: 'yearly', behavior: 'reach_balance', amount: 10, anchorDate: FUTURE },
        /A yearly goal cannot use reach_balance/,
      ],
      [
        'by_date with a past due date',
        { frequency: 'by_date', behavior: 'reach_balance', amount: 10, anchorDate: PAST },
        /The due date must be in the future/,
      ],
      [
        'open_ended with budget_another',
        { frequency: 'open_ended', behavior: 'budget_another', amount: 10 },
        /A open_ended goal cannot use budget_another/,
      ],
    ];

    it.each(allowed)('allows a valid %s goal', async (_frequency, body) => {
      setLineGoalService.mockResolvedValue(GOAL_ENTRY as never);

      await call({ tool, args: { ...base, ...body } });

      expect(setLineGoalService).toHaveBeenCalledWith({ userId: 42, ...base, ...body });
    });

    it.each(refused)('refuses %s', async (_name, body, message) => {
      await expect(call({ tool, args: { ...base, ...body } })).rejects.toThrow(message);
      expect(setLineGoalService).not.toHaveBeenCalled();
    });

    it('refuses a repeat pair that is not complete, one that is too long and one on the wrong goal', async () => {
      const byDate = { ...base, frequency: 'by_date', behavior: 'budget_another', amount: 10, anchorDate: FUTURE };

      await expect(call({ tool, args: { ...byDate, repeatEvery: 2 } })).rejects.toThrow(
        /repeatEvery and repeatUnit go together/,
      );
      await expect(call({ tool, args: { ...byDate, repeatEvery: 12, repeatUnit: 'months' } })).rejects.toThrow(
        /Repeat every 1 to 11 months/,
      );
      await expect(
        call({ tool, args: { ...byDate, behavior: 'reach_balance', repeatEvery: 2, repeatUnit: 'months' } }),
      ).rejects.toThrow(/Only a by_date budget_another or refill_up_to goal repeats/);
      expect(setLineGoalService).not.toHaveBeenCalled();
    });

    it('refuses stopAtBalance and fundingCap on the wrong behavior', async () => {
      await expect(
        call({ tool, args: { ...base, ...goal, behavior: 'refill_up_to', stopAtBalance: 50 } }),
      ).rejects.toThrow(/Only a budget_another goal takes stopAtBalance/);
      await expect(call({ tool, args: { ...base, ...goal, fundingCap: 50 } })).rejects.toThrow(
        /Only a refill_up_to goal takes fundingCap/,
      );
      expect(setLineGoalService).not.toHaveBeenCalled();
    });

    it('refuses an unknown field of the goal body', async () => {
      await expect(call({ tool, args: { ...base, ...goal, extra: 1 } })).rejects.toThrow();
      expect(setLineGoalService).not.toHaveBeenCalled();
    });
  });

  it("passes another user's line through as the service not-found error, scoped to the caller", async () => {
    setLineGoalService.mockRejectedValue(new NotFoundError({ message: 'Line not found' }));

    await expect(
      call({ tool, args: { ...base, ...goal }, extra: makeExtra({ userId: 7, features: [FEATURES.budget_plan] }) }),
    ).rejects.toThrow('Line not found');
    expect(setLineGoalService).toHaveBeenCalledWith(expect.objectContaining({ userId: 7 }));
  });

  it('says what the goal means, that it replaces any goal and which combinations are refused', () => {
    expect(tool.config.description).toMatch(/replace/i);
    expect(tool.config.description).toMatch(/delete_budget_plan_line_goal/);
    expect(tool.config.description).toMatch(/weekday/);
    expect(tool.config.description).toMatch(/anchorDate/);
    expect(tool.config.description).toMatch(/reach_balance/);
  });
});

describe('delete_budget_plan_line_goal', () => {
  const tool = captureTools({ register: registerDeleteBudgetPlanLineGoal })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name with both ids', () => {
    expect(tool.name).toBe('delete_budget_plan_line_goal');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(['lineId', 'planId']);
    expect(schema.safeParse({ planId: PLAN_ID, lineId: LINE_ID }).success).toBe(true);
    expect(schema.safeParse({ planId: PLAN_ID }).success).toBe(false);
    expect(schema.safeParse({ lineId: LINE_ID }).success).toBe(false);
  });

  it('deletes the goal of the caller line', async () => {
    const data = await call({ tool, args: { planId: PLAN_ID, lineId: LINE_ID } });

    expect(deleteLineGoalService).toHaveBeenCalledWith({ userId: 42, planId: PLAN_ID, lineId: LINE_ID });
    expect(data).toEqual({ deleted: true, lineId: LINE_ID, planId: PLAN_ID });
  });

  it('passes the missing-goal refusal through', async () => {
    deleteLineGoalService.mockRejectedValue(new NotFoundError({ message: 'Goal not found' }));

    await expect(call({ tool, args: { planId: PLAN_ID, lineId: LINE_ID } })).rejects.toThrow('Goal not found');
  });

  it('needs the delete scope, not the write scope', async () => {
    await expect(
      call({
        tool,
        args: { planId: PLAN_ID, lineId: LINE_ID },
        extra: makeExtra({ scopes: ['finance:read', 'finance:write'], features: [FEATURES.budget_plan] }),
      }),
    ).rejects.toThrow(/Missing required scope: finance:delete/);
    expect(deleteLineGoalService).not.toHaveBeenCalled();
  });

  it('warns that it is irreversible', () => {
    expect(tool.config.description).toMatch(/irreversible|cannot be undone/i);
  });
});

describe('snooze_budget_plan_line_goal', () => {
  const tool = captureTools({ register: registerSnoozeBudgetPlanLineGoal })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();
  const args = { planId: PLAN_ID, lineId: LINE_ID, periodId: PERIOD_ID };

  it('registers under its name with the two ids and the period, all required', () => {
    expect(tool.name).toBe('snooze_budget_plan_line_goal');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(['lineId', 'periodId', 'planId']);
    expect(schema.safeParse(args).success).toBe(true);
    expect(schema.safeParse({ planId: PLAN_ID, lineId: LINE_ID }).success).toBe(false);
    expect(schema.safeParse({ ...args, periodId: 'nope' }).success).toBe(false);
  });

  it('snoozes the goal for the period and returns it', async () => {
    snoozeLineGoalService.mockResolvedValue(GOAL_ENTRY as never);

    const data = await call({ tool, args });

    expect(snoozeLineGoalService).toHaveBeenCalledWith({ userId: 42, ...args });
    expect(data).toEqual(GOAL_ENTRY);
  });

  it('passes the open-ended refusal through', async () => {
    snoozeLineGoalService.mockRejectedValue(new ValidationError({ message: 'An open-ended goal cannot be snoozed' }));

    await expect(call({ tool, args })).rejects.toThrow('An open-ended goal cannot be snoozed');
  });

  it('says that snoozing the snoozed period wakes the goal up and that open-ended goals cannot snooze', () => {
    expect(tool.config.description).toMatch(/again|wakes|toggle/i);
    expect(tool.config.description).toMatch(/open_ended/);
  });
});

describe('set_budget_plan_assignment', () => {
  const tool = captureTools({ register: registerSetBudgetPlanAssignment })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();
  const base = { planId: PLAN_ID, periodId: PERIOD_ID, lineId: LINE_ID, scope: 'from_here' };
  const VIEW = { id: PERIOD_ID, lines: [] };

  it('registers under its name with the three ids and every field of the REST body', () => {
    expect(tool.name).toBe('set_budget_plan_assignment');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      ['lineId', 'periodId', 'planId', ...Object.keys(setAssignmentBodyFields)].toSorted(),
    );
    expect(Object.keys(setAssignmentBodyFields).toSorted()).toEqual(['amount', 'carryPolicy', 'scope']);
  });

  it('applies the REST validation', () => {
    for (const scope of BUDGET_ASSIGNMENT_SCOPES) {
      expect(schema.safeParse({ ...base, scope, amount: 10 }).success).toBe(true);
    }
    for (const carryPolicy of BUDGET_PLAN_CARRY_POLICIES) {
      expect(schema.safeParse({ ...base, carryPolicy }).success).toBe(true);
    }
    expect(schema.safeParse({ ...base, amount: null, carryPolicy: null }).success).toBe(true);
    expect(schema.safeParse({ ...base, amount: 0 }).success).toBe(true);

    const invalid: Record<string, unknown>[] = [
      { planId: undefined },
      { periodId: undefined },
      { lineId: undefined },
      { scope: undefined },
      { scope: 'always' },
      { amount: -1 },
      { amount: '10' },
      { carryPolicy: 'whatever' },
      { unknownField: 1 },
    ];
    for (const patch of invalid) {
      expect([patch, schema.safeParse({ ...base, amount: 10, ...patch }).success]).toEqual([patch, false]);
    }
  });

  it('keeps the REST body schema strict and refuses an empty change', () => {
    expect(setAssignmentBodySchema.safeParse({ scope: 'from_here', amount: 5 }).success).toBe(true);
    expect(setAssignmentBodySchema.safeParse({ scope: 'from_here', carryPolicy: null }).success).toBe(true);
    expect(setAssignmentBodySchema.safeParse({ scope: 'from_here' }).success).toBe(false);
    expect(setAssignmentBodySchema.safeParse({ scope: 'from_here', amount: 5, extra: 1 }).success).toBe(false);
  });

  it('sets the amount for the caller line and returns the period view', async () => {
    setAssignmentService.mockResolvedValue(VIEW as never);

    const data = await call({ tool, args: { ...base, amount: 250 } });

    expect(setAssignmentService).toHaveBeenCalledTimes(1);
    expect(setAssignmentService).toHaveBeenCalledWith({
      userId: 42,
      planId: PLAN_ID,
      periodId: PERIOD_ID,
      lineId: LINE_ID,
      scope: 'from_here',
      amount: 250,
    });
    expect(data).toEqual(VIEW);
  });

  it('passes a null amount and a carry policy through, leaving an omitted field out', async () => {
    setAssignmentService.mockResolvedValue(VIEW as never);

    await call({ tool, args: { ...base, scope: 'this_period', amount: null, carryPolicy: 'signed' } });
    expect(setAssignmentService).toHaveBeenLastCalledWith({
      userId: 42,
      planId: PLAN_ID,
      periodId: PERIOD_ID,
      lineId: LINE_ID,
      scope: 'this_period',
      amount: null,
      carryPolicy: 'signed',
    });

    await call({ tool, args: { ...base, carryPolicy: null } });
    expect(setAssignmentService).toHaveBeenLastCalledWith({
      userId: 42,
      planId: PLAN_ID,
      periodId: PERIOD_ID,
      lineId: LINE_ID,
      scope: 'from_here',
      carryPolicy: null,
    });
  });

  it('rejects a call with neither amount nor carryPolicy in the handler, with the service not called', async () => {
    await expect(call({ tool, args: base })).rejects.toThrow(/Provide amount, carryPolicy, or both/);
    expect(setAssignmentService).not.toHaveBeenCalled();
  });

  it('passes the line-outside-lifetime refusal through, scoped to the caller', async () => {
    setAssignmentService.mockRejectedValue(new NotFoundError({ message: 'Period not found' }));

    await expect(
      call({ tool, args: { ...base, amount: 5 }, extra: makeExtra({ userId: 7, features: [FEATURES.budget_plan] }) }),
    ).rejects.toThrow('Period not found');
    expect(setAssignmentService).toHaveBeenCalledWith(expect.objectContaining({ userId: 7 }));
  });

  it('says what scope, null and an omitted field mean', () => {
    expect(tool.config.description).toMatch(/from_here/);
    expect(tool.config.description).toMatch(/this_period/);
    expect(tool.config.description).toMatch(/null/);
    expect(tool.config.description).toMatch(/get_budget_plan_period/);
  });
});

const GOAL_TOOLS = [
  {
    register: registerSetBudgetPlanLineGoal,
    name: 'set_budget_plan_line_goal',
    result: GOAL_ENTRY,
    args: { planId: PLAN_ID, lineId: LINE_ID, frequency: 'every_period', behavior: 'budget_another', amount: 100 },
    service: setLineGoalService,
    scopes: ['finance:read', 'finance:write'],
  },
  {
    register: registerDeleteBudgetPlanLineGoal,
    name: 'delete_budget_plan_line_goal',
    result: undefined,
    args: { planId: PLAN_ID, lineId: LINE_ID },
    service: deleteLineGoalService,
    scopes: ['finance:read', 'finance:delete'],
  },
  {
    register: registerSnoozeBudgetPlanLineGoal,
    name: 'snooze_budget_plan_line_goal',
    result: GOAL_ENTRY,
    args: { planId: PLAN_ID, lineId: LINE_ID, periodId: PERIOD_ID },
    service: snoozeLineGoalService,
    scopes: ['finance:read', 'finance:write'],
  },
  {
    register: registerSetBudgetPlanAssignment,
    name: 'set_budget_plan_assignment',
    result: { id: PERIOD_ID },
    args: { planId: PLAN_ID, periodId: PERIOD_ID, lineId: LINE_ID, scope: 'from_here', amount: 5 },
    service: setAssignmentService,
    scopes: ['finance:read', 'finance:write'],
  },
];

describe.each(GOAL_TOOLS)('$name write guards', ({ register, name, args, service, scopes, result }) => {
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

  it('runs with the budget plan feature and a free lock', async () => {
    service.mockResolvedValue(result as never);
    await tool.handler(args, ok);

    expect(service).toHaveBeenCalledTimes(1);
  });
});
