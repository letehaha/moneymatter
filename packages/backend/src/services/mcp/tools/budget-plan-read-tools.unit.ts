import { FEATURES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundError } from '@js/errors';
import { getPeriodView } from '@services/budget-plans/get-period-view';
import { getPlan, listPlans } from '@services/budget-plans/get-plan';
import { getScheduled } from '@services/budget-plans/get-scheduled';
import { getTrends } from '@services/budget-plans/get-trends';
import { listPeriods } from '@services/budget-plans/list-periods';
import { getSuggestionContext } from '@services/budget-plans/suggested-lines';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Block the real services, whose import chains build queues at module scope and would open
// Redis connections in a unit test.
jest.mock('@services/budget-plans/get-plan', () => ({ getPlan: jest.fn(), listPlans: jest.fn() }));
jest.mock('@services/budget-plans/list-periods', () => ({ listPeriods: jest.fn() }));
jest.mock('@services/budget-plans/get-period-view', () => ({ getPeriodView: jest.fn() }));
jest.mock('@services/budget-plans/get-scheduled', () => ({ getScheduled: jest.fn() }));
jest.mock('@services/budget-plans/get-trends', () => ({ getTrends: jest.fn() }));
jest.mock('@services/budget-plans/suggested-lines', () => ({ getSuggestionContext: jest.fn() }));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { registerGetBudgetPlanPeriod } from './get-budget-plan-period';
import { registerGetBudgetPlanScheduled } from './get-budget-plan-scheduled';
import { registerGetBudgetPlanSuggestionContext } from './get-budget-plan-suggestion-context';
import { registerGetBudgetPlanTrends } from './get-budget-plan-trends';
import { registerListBudgetPlanPeriods } from './list-budget-plan-periods';
import { registerListBudgetPlans } from './list-budget-plans';

// A reader with no plan feature and a read-only plan: reads are neither feature-gated nor
// write-gated in REST, so neither limits the tools.
const READER = makeExtra({ scopes: ['finance:read'], readOnly: true, features: [] });
const OTHER_READER = makeExtra({ userId: 7, scopes: ['finance:read'], readOnly: true });

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const listPlansService = jest.mocked(listPlans);
const getPlanService = jest.mocked(getPlan);
const listPeriodsService = jest.mocked(listPeriods);
const getPeriodViewService = jest.mocked(getPeriodView);
const getScheduledService = jest.mocked(getScheduled);
const getTrendsService = jest.mocked(getTrends);
const getSuggestionContextService = jest.mocked(getSuggestionContext);

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const PERIOD_ID = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ACCOUNT_ID = '44444444-4444-4444-8444-444444444444';
const LINE_ID = '55555555-5555-4555-8555-555555555555';

const call = async ({
  tool,
  args,
  extra = READER,
}: {
  tool: ReturnType<typeof captureTools>[number];
  args?: unknown;
  extra?: ReturnType<typeof makeExtra>;
}) => parseToolResult({ result: await (args === undefined ? tool.handler(extra) : tool.handler(args, extra)) });

/** A plan row as the model returns it: Money for the income, Dates for the audit fields, the owner id. */
const makePlanRow = (patch: Record<string, unknown> = {}) => ({
  id: PLAN_ID,
  userId: 42,
  name: 'Household',
  type: 'monthly',
  currencyCode: 'USD',
  cadence: 'months',
  intervalN: 1,
  anchorDate: '2026-01-01',
  secondAnchorDay: null,
  epochDate: '2026-01-01',
  carryPolicy: 'carry',
  autoAttachAccounts: true,
  poolFrom: null,
  zeroSum: false,
  expectedIncome: Money.fromDecimal(3_500.25),
  createdAt: new Date('2026-01-01T08:00:00.000Z'),
  updatedAt: new Date('2026-02-01T08:00:00.000Z'),
  deletedAt: null,
  ...patch,
});

/** What an assistant sees of that plan: no owner id and no audit timestamps. */
const presentedPlan = (patch: Record<string, unknown> = {}) => ({
  id: PLAN_ID,
  name: 'Household',
  type: 'monthly',
  currencyCode: 'USD',
  cadence: 'months',
  intervalN: 1,
  anchorDate: '2026-01-01',
  secondAnchorDay: null,
  epochDate: '2026-01-01',
  carryPolicy: 'carry',
  autoAttachAccounts: true,
  poolFrom: null,
  zeroSum: false,
  expectedIncome: 3_500.25,
  deletedAt: null,
  ...patch,
});

const makePeriods = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    startDate: `2026-01-${String(index + 1).padStart(2, '0')}`,
    endDate: `2026-01-${String(index + 2).padStart(2, '0')}`,
    isCurrent: index === 3,
  }));

beforeEach(() => {
  jest.resetAllMocks();
  lockCheck.mockResolvedValue(false);
});

describe('list_budget_plans', () => {
  const tool = captureTools({ register: registerListBudgetPlans })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name and takes an optional plan id and includeDeleted', () => {
    expect(tool.name).toBe('list_budget_plans');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['planId', 'includeDeleted']);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ planId: PLAN_ID, includeDeleted: true }).success).toBe(true);
    expect(schema.safeParse({ planId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ includeDeleted: 'yes' }).success).toBe(false);
  });

  it('lists the plans of the caller slimmed, without a plan feature, write access or a free base currency', async () => {
    lockCheck.mockResolvedValue(true);
    listPlansService.mockResolvedValue([makePlanRow(), makePlanRow({ id: LINE_ID, expectedIncome: null })] as never);

    const data = await call({ tool, args: {} });

    expect(listPlansService).toHaveBeenCalledWith({ userId: 42, includeDeleted: undefined });
    expect(getPlanService).not.toHaveBeenCalled();
    expect(data).toEqual([presentedPlan(), presentedPlan({ id: LINE_ID, expectedIncome: null })]);
  });

  it('passes includeDeleted through and shows when a plan was deleted', async () => {
    listPlansService.mockResolvedValue([makePlanRow({ deletedAt: new Date('2026-03-01T00:00:00.000Z') })] as never);

    const data = await call({ tool, args: { includeDeleted: true } });

    expect(listPlansService).toHaveBeenCalledWith({ userId: 42, includeDeleted: true });
    expect(data).toEqual([presentedPlan({ deletedAt: '2026-03-01T00:00:00.000Z' })]);
  });

  it('returns an empty list for a user without plans', async () => {
    listPlansService.mockResolvedValue([] as never);

    expect(await call({ tool, args: {} })).toEqual([]);
  });

  it('leaves out the owner id and the audit timestamps', async () => {
    listPlansService.mockResolvedValue([makePlanRow()] as never);

    const [plan] = (await call({ tool, args: {} })) as Record<string, unknown>[];

    for (const key of ['userId', 'createdAt', 'updatedAt']) expect(plan).not.toHaveProperty(key);
  });

  it('reads one plan with its accounts and lines for the caller', async () => {
    getPlanService.mockResolvedValue({
      plan: { ...makePlanRow(), expectedIncome: 3_500.25, createdAt: '2026-01-01T08:00:00.000Z' },
      accountIds: [ACCOUNT_ID],
      lines: [
        {
          id: LINE_ID,
          name: 'Groceries',
          sortOrder: 0,
          groupId: null,
          activeFrom: '2026-01-01',
          activeUntil: null,
          categoryIds: [OTHER_ACCOUNT_ID],
        },
      ],
    } as never);

    const data = await call({ tool, args: { planId: PLAN_ID } });

    expect(getPlanService).toHaveBeenCalledWith({ userId: 42, planId: PLAN_ID });
    expect(listPlansService).not.toHaveBeenCalled();
    expect(data).toEqual({
      plan: presentedPlan(),
      accountIds: [ACCOUNT_ID],
      lines: [
        {
          id: LINE_ID,
          name: 'Groceries',
          sortOrder: 0,
          groupId: null,
          activeFrom: '2026-01-01',
          activeUntil: null,
          categoryIds: [OTHER_ACCOUNT_ID],
        },
      ],
    });
  });

  it("scopes every read to the caller and passes another user's plan through as the service not-found error", async () => {
    getPlanService.mockRejectedValue(new NotFoundError({ message: 'Budget plan not found' }));

    await expect(call({ tool, args: { planId: PLAN_ID }, extra: OTHER_READER })).rejects.toThrow(
      'Budget plan not found',
    );
    expect(getPlanService).toHaveBeenCalledWith({ userId: 7, planId: PLAN_ID });
  });
});

describe('get_budget_plan_suggestion_context', () => {
  const tool = captureTools({ register: registerGetBudgetPlanSuggestionContext })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name and takes only optional account ids', () => {
    expect(tool.name).toBe('get_budget_plan_suggestion_context');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['accountIds']);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ accountIds: [ACCOUNT_ID, OTHER_ACCOUNT_ID] }).success).toBe(true);
    expect(schema.safeParse({ accountIds: ['nope'] }).success).toBe(false);
    expect(schema.safeParse({ accountIds: ACCOUNT_ID }).success).toBe(false);
  });

  it('reads the context for the caller and the given accounts', async () => {
    const context = { hasHistory: true, categories: [{ id: LINE_ID, monthlyAvg: 420.5 }] };
    getSuggestionContextService.mockResolvedValue(context as never);

    const data = await call({ tool, args: { accountIds: [ACCOUNT_ID] } });

    expect(getSuggestionContextService).toHaveBeenCalledWith({ userId: 42, accountIds: [ACCOUNT_ID] });
    expect(data).toEqual(context);
  });

  it('asks for no accounts when none are given, as REST does', async () => {
    getSuggestionContextService.mockResolvedValue({ hasHistory: false, categories: [] } as never);

    await call({ tool, args: {} });

    expect(getSuggestionContextService).toHaveBeenCalledWith({ userId: 42, accountIds: [] });
  });

  it('keeps the starter categories that have no average', async () => {
    const context = { hasHistory: false, categories: [{ id: LINE_ID, monthlyAvg: null }] };
    getSuggestionContextService.mockResolvedValue(context as never);

    expect(await call({ tool, args: {} })).toEqual(context);
  });
});

describe('list_budget_plan_periods', () => {
  const tool = captureTools({ register: registerListBudgetPlanPeriods })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name and bounds limit and offset', () => {
    expect(tool.name).toBe('list_budget_plan_periods');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['planId', 'limit', 'offset']);
    expect(schema.safeParse({ planId: PLAN_ID }).success).toBe(true);
    expect(schema.safeParse({ planId: PLAN_ID, limit: 200, offset: 5 }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ planId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ planId: PLAN_ID, limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ planId: PLAN_ID, limit: 201 }).success).toBe(false);
    expect(schema.safeParse({ planId: PLAN_ID, limit: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ planId: PLAN_ID, offset: -1 }).success).toBe(false);
  });

  it('returns the newest 24 periods first by default, with the total', async () => {
    const periods = makePeriods(30);
    listPeriodsService.mockResolvedValue(periods as never);

    const data = (await call({ tool, args: { planId: PLAN_ID } })) as { periods: unknown[]; total: number };

    expect(listPeriodsService).toHaveBeenCalledWith({ userId: 42, planId: PLAN_ID });
    expect(data.total).toBe(30);
    expect(data.periods).toEqual(periods.slice(6).toReversed());
  });

  it('pages back through older periods with offset and limit', async () => {
    const periods = makePeriods(30);
    listPeriodsService.mockResolvedValue(periods as never);

    const data = (await call({ tool, args: { planId: PLAN_ID, limit: 5, offset: 10 } })) as {
      periods: unknown[];
      total: number;
    };

    expect(data.periods).toEqual(periods.slice(15, 20).toReversed());
    expect(data.total).toBe(30);
  });

  it('returns an empty page past the end', async () => {
    listPeriodsService.mockResolvedValue(makePeriods(3) as never);

    expect(await call({ tool, args: { planId: PLAN_ID, offset: 50 } })).toEqual({ periods: [], total: 3 });
  });

  it("scopes the read to the caller and passes another user's plan through as the service not-found error", async () => {
    listPeriodsService.mockRejectedValue(new NotFoundError({ message: 'Budget plan not found' }));

    await expect(call({ tool, args: { planId: PLAN_ID }, extra: OTHER_READER })).rejects.toThrow(
      'Budget plan not found',
    );
    expect(listPeriodsService).toHaveBeenCalledWith({ userId: 7, planId: PLAN_ID });
  });
});

describe('get_budget_plan_period', () => {
  const tool = captureTools({ register: registerGetBudgetPlanPeriod })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name and needs a plan id and a period id', () => {
    expect(tool.name).toBe('get_budget_plan_period');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['planId', 'periodId']);
    expect(schema.safeParse({ planId: PLAN_ID, periodId: PERIOD_ID }).success).toBe(true);
    expect(schema.safeParse({ planId: PLAN_ID }).success).toBe(false);
    expect(schema.safeParse({ periodId: PERIOD_ID }).success).toBe(false);
    expect(schema.safeParse({ planId: PLAN_ID, periodId: 'nope' }).success).toBe(false);
  });

  it('returns the period view the REST route returns, for the caller', async () => {
    const view = {
      period: { id: PERIOD_ID, startDate: '2026-10-01', endDate: '2026-11-01', isCurrent: true },
      header: { totalAssigned: 1_000.5, totalActivity: -400.25, totalAvailable: 600.25, totalCarriedIn: 0 },
      groups: [],
      lines: [],
      pool: null,
      unbudgeted: [{ categoryId: LINE_ID, activity: -12.5 }],
      goals: null,
      coverage: null,
    };
    getPeriodViewService.mockResolvedValue(view as never);

    const data = await call({ tool, args: { planId: PLAN_ID, periodId: PERIOD_ID } });

    expect(getPeriodViewService).toHaveBeenCalledWith({ userId: 42, planId: PLAN_ID, periodId: PERIOD_ID });
    expect(data).toEqual(view);
  });

  it("scopes the read to the caller and passes another user's plan through as the service not-found error", async () => {
    getPeriodViewService.mockRejectedValue(new NotFoundError({ message: 'Budget plan not found' }));

    await expect(call({ tool, args: { planId: PLAN_ID, periodId: PERIOD_ID }, extra: OTHER_READER })).rejects.toThrow(
      'Budget plan not found',
    );
    expect(getPeriodViewService).toHaveBeenCalledWith({ userId: 7, planId: PLAN_ID, periodId: PERIOD_ID });
  });
});

describe('get_budget_plan_scheduled', () => {
  const tool = captureTools({ register: registerGetBudgetPlanScheduled })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name and needs a plan id and a period id', () => {
    expect(tool.name).toBe('get_budget_plan_scheduled');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['planId', 'periodId']);
    expect(schema.safeParse({ planId: PLAN_ID, periodId: PERIOD_ID }).success).toBe(true);
    expect(schema.safeParse({ planId: PLAN_ID }).success).toBe(false);
    expect(schema.safeParse({ planId: PLAN_ID, periodId: 'nope' }).success).toBe(false);
  });

  it('returns the scheduled items and totals for the caller', async () => {
    const scheduled = {
      items: [
        {
          source: 'planned',
          id: LINE_ID,
          name: 'Rent',
          date: '2026-10-25',
          amount: -900.5,
          currencyCode: 'EUR',
          nativeAmount: -800,
          categoryId: null,
          lineId: null,
          accountId: ACCOUNT_ID,
        },
      ],
      outflows: { total: -900.5, count: 1 },
      inflows: { total: 0, count: 0 },
      nextDate: '2026-10-25',
    };
    getScheduledService.mockResolvedValue(scheduled as never);

    const data = await call({ tool, args: { planId: PLAN_ID, periodId: PERIOD_ID } });

    expect(getScheduledService).toHaveBeenCalledWith({ userId: 42, planId: PLAN_ID, periodId: PERIOD_ID });
    expect(data).toEqual(scheduled);
  });

  it('works for a user without the plan feature during a base-currency change', async () => {
    lockCheck.mockResolvedValue(true);
    getScheduledService.mockResolvedValue({
      items: [],
      outflows: { total: 0, count: 0 },
      inflows: { total: 0, count: 0 },
      nextDate: null,
    } as never);

    await expect(call({ tool, args: { planId: PLAN_ID, periodId: PERIOD_ID } })).resolves.toMatchObject({
      nextDate: null,
    });
    expect(lockCheck).not.toHaveBeenCalled();
  });

  it("scopes the read to the caller and passes another user's plan through as the service not-found error", async () => {
    getScheduledService.mockRejectedValue(new NotFoundError({ message: 'Budget plan not found' }));

    await expect(call({ tool, args: { planId: PLAN_ID, periodId: PERIOD_ID }, extra: OTHER_READER })).rejects.toThrow(
      'Budget plan not found',
    );
    expect(getScheduledService).toHaveBeenCalledWith({ userId: 7, planId: PLAN_ID, periodId: PERIOD_ID });
  });
});

describe('get_budget_plan_trends', () => {
  const tool = captureTools({ register: registerGetBudgetPlanTrends })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name and bounds count to 1..24', () => {
    expect(tool.name).toBe('get_budget_plan_trends');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['planId', 'until', 'count']);
    expect(schema.safeParse({ planId: PLAN_ID }).success).toBe(true);
    expect(schema.safeParse({ planId: PLAN_ID, until: PERIOD_ID, count: 24 }).success).toBe(true);
    expect(schema.safeParse({ planId: PLAN_ID, count: 1 }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ planId: PLAN_ID, count: 0 }).success).toBe(false);
    expect(schema.safeParse({ planId: PLAN_ID, count: 25 }).success).toBe(false);
    expect(schema.safeParse({ planId: PLAN_ID, count: 2.5 }).success).toBe(false);
    expect(schema.safeParse({ planId: PLAN_ID, until: 'nope' }).success).toBe(false);
  });

  it('defaults count to 6 and leaves until to the service', async () => {
    getTrendsService.mockResolvedValue({ periods: [] } as never);

    await call({ tool, args: { planId: PLAN_ID } });

    expect(getTrendsService).toHaveBeenCalledWith({ userId: 42, planId: PLAN_ID, until: undefined, count: 6 });
  });

  it('passes until and count through and returns the trends the REST route returns', async () => {
    const trends = {
      periods: [
        {
          periodId: PERIOD_ID,
          startDate: '2026-09-01',
          endDate: '2026-10-01',
          assigned: 1_000.5,
          activity: -950.25,
          carriedIn: 10,
          available: 60.25,
          lines: [{ lineId: LINE_ID, assigned: 500, activity: -480.5, available: 19.5 }],
        },
      ],
    };
    getTrendsService.mockResolvedValue(trends as never);

    const data = await call({ tool, args: { planId: PLAN_ID, until: PERIOD_ID, count: 12 } });

    expect(getTrendsService).toHaveBeenCalledWith({ userId: 42, planId: PLAN_ID, until: PERIOD_ID, count: 12 });
    expect(data).toEqual(trends);
  });

  it("scopes the read to the caller and passes another user's plan through as the service not-found error", async () => {
    getTrendsService.mockRejectedValue(new NotFoundError({ message: 'Budget plan not found' }));

    await expect(call({ tool, args: { planId: PLAN_ID }, extra: OTHER_READER })).rejects.toThrow(
      'Budget plan not found',
    );
    expect(getTrendsService).toHaveBeenCalledWith({ userId: 7, planId: PLAN_ID, until: undefined, count: 6 });
  });
});

describe('every budget plan read tool', () => {
  const tools = captureTools({
    register: [
      registerListBudgetPlans,
      registerGetBudgetPlanSuggestionContext,
      registerListBudgetPlanPeriods,
      registerGetBudgetPlanPeriod,
      registerGetBudgetPlanScheduled,
      registerGetBudgetPlanTrends,
    ],
  });

  it('registers six read-named tools', () => {
    expect(tools.map((tool) => tool.name)).toEqual([
      'list_budget_plans',
      'get_budget_plan_suggestion_context',
      'list_budget_plan_periods',
      'get_budget_plan_period',
      'get_budget_plan_scheduled',
      'get_budget_plan_trends',
    ]);
  });

  it('refuses an unauthenticated call', async () => {
    for (const tool of tools) {
      await expect(
        tool.handler({ planId: PLAN_ID, periodId: PERIOD_ID }, {
          authInfo: { scopes: [], extra: {} },
        } as never),
      ).rejects.toThrow(/Authentication required/);
    }
  });

  it('does not gate reads on the budget plan feature, even for a plan without it', async () => {
    getTrendsService.mockResolvedValue({ periods: [] } as never);
    const withFeature = makeExtra({ scopes: ['finance:read'], features: [FEATURES.budget_plan] });

    await expect(call({ tool: tools[5]!, args: { planId: PLAN_ID }, extra: READER })).resolves.toEqual({ periods: [] });
    await expect(call({ tool: tools[5]!, args: { planId: PLAN_ID }, extra: withFeature })).resolves.toEqual({
      periods: [],
    });
  });
});
