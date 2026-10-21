import { useGoals } from '@/composable/data-queries/goals';
import { computeGoalProgress } from '@bt/shared/goals/goal-math';
import type { GoalMathInput, GoalModel, RecordId } from '@bt/shared/types';
import { describe, expect, it, vi } from 'vitest';
import { nextTick, ref, shallowRef } from 'vue';

import {
  type GoalWhatIfEdits,
  type GoalWithInsights,
  buildWhatIfInput,
  clampShare,
  getImpliedDeposits,
  getMonthlySliderRange,
  useGoalWhatIf,
} from './use-goal-what-if';

vi.mock('@/composable/data-queries/goals', () => ({ useGoals: vi.fn() }));

const id = (value: string) => value as RecordId;

const input: GoalMathInput = {
  today: '2026-10-20',
  months: [
    '2026-03-31',
    '2026-04-30',
    '2026-05-31',
    '2026-06-30',
    '2026-07-31',
    '2026-08-31',
    '2026-09-30',
    '2026-10-20',
  ],
  accounts: [
    {
      accountId: id('a'),
      sharePercent: 100,
      currentBalance: 650,
      creditLimit: 0,
      firstDataDate: '2026-01-01',
      monthEndBalances: [0, 100, 200, 300, 400, 500, 600, 650],
    },
    {
      accountId: id('b'),
      sharePercent: 50,
      currentBalance: 1000,
      creditLimit: 0,
      firstDataDate: '2026-01-01',
      monthEndBalances: [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000],
    },
  ],
  targetAmount: 5000,
  targetDate: '2028-10-20',
  plannedMonthly: null,
};

const insights = { input, rateToBase: 2 };
const buildEdits = (overrides: Partial<GoalWhatIfEdits> = {}): GoalWhatIfEdits => ({
  monthly: null,
  targetDate: input.targetDate,
  shares: { [id('a')]: 100, [id('b')]: 50 },
  ...overrides,
});

describe('buildWhatIfInput', () => {
  it('reproduces the server input when nothing is edited', () => {
    expect(buildWhatIfInput({ insights, plannedMonthly: null, edits: buildEdits() })).toEqual(input);
  });

  it('re-weights current value and pace from the per-account series', () => {
    const progress = computeGoalProgress(
      buildWhatIfInput({
        insights,
        plannedMonthly: null,
        edits: buildEdits({ shares: { [id('a')]: 50, [id('b')]: 50 } }),
      }),
    );
    expect(progress.currentValue).toBe(825);
    expect(progress.historicalPace).toBe(50);
  });

  it('drops accounts whose share is 0 or empty', () => {
    const result = buildWhatIfInput({
      insights,
      plannedMonthly: null,
      edits: buildEdits({ shares: { [id('a')]: 0, [id('b')]: null } }),
    });
    expect(result.accounts).toEqual([]);
    expect(computeGoalProgress(result).status).toBe('no_accounts');
  });

  it('converts an edited monthly amount from the goal currency to base', () => {
    const result = buildWhatIfInput({ insights, plannedMonthly: null, edits: buildEdits({ monthly: 30 }) });
    expect(result.plannedMonthly).toBe(60);
  });

  it('keeps the server figure for an unchanged plan', () => {
    const result = buildWhatIfInput({
      insights: { input: { ...input, plannedMonthly: 66.67 }, rateToBase: 2 },
      plannedMonthly: 33.33,
      edits: buildEdits({ monthly: 33.33 }),
    });
    expect(result.plannedMonthly).toBe(66.67);
  });

  it('applies the edited target date', () => {
    const result = buildWhatIfInput({ insights, plannedMonthly: null, edits: buildEdits({ targetDate: null }) });
    expect(computeGoalProgress(result).status).toBe('no_date');
  });
});

describe('getImpliedDeposits', () => {
  it('scales the monthly amount by each share and skips empty shares', () => {
    expect(
      getImpliedDeposits({
        monthly: 2200,
        accounts: [
          { accountId: id('a'), sharePercent: 100 },
          { accountId: id('b'), sharePercent: 25 },
          { accountId: id('c'), sharePercent: 0 },
        ],
      }),
    ).toEqual([
      { accountId: id('a'), deposit: 2200 },
      { accountId: id('b'), deposit: 8800 },
    ]);
  });
});

describe('clampShare', () => {
  it('keeps the share within 0 and the free capacity, two decimals', () => {
    expect(clampShare({ value: 80, max: 50 })).toBe(50);
    expect(clampShare({ value: -5, max: 50 })).toBe(0);
    expect(clampShare({ value: 33.333, max: 100 })).toBe(33.33);
    expect(clampShare({ value: null, max: 100 })).toBeNull();
  });
});

const buildGoal = (overrides: Partial<GoalWithInsights> = {}): GoalWithInsights => ({
  id: id('goal'),
  name: 'Car',
  currencyCode: 'UAH',
  targetAmount: 5000,
  targetDate: input.targetDate,
  plannedMonthly: null,
  status: 'active',
  achievedAt: null,
  achievedAmount: null,
  sortOrder: 0,
  accounts: [
    { accountId: id('a'), sharePercent: 60 },
    { accountId: id('b'), sharePercent: 50 },
  ],
  insights: { ...computeGoalProgress(input), input, rateToBase: 1, baseCurrencyCode: 'UAH' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  logoDomain: null,
  logoInitials: null,
  logoColor: null,
  logoIcon: null,
  logoImageId: null,
  ...overrides,
});

const setup = ({
  goal = buildGoal(),
  goals = [goal],
}: { goal?: GoalWithInsights; goals?: GoalModel[] | null } = {}) => {
  vi.mocked(useGoals).mockReturnValue({ data: ref(goals ?? undefined) } as unknown as ReturnType<typeof useGoals>);
  const goalRef = shallowRef(goal);
  return { goalRef, ...useGoalWhatIf({ goal: goalRef }) };
};

describe('useGoalWhatIf', () => {
  it('clears an existing plan, and treats a monthly of 0 as no plan', () => {
    const { edits, applyValues } = setup({ goal: buildGoal({ plannedMonthly: 300 }) });
    expect(applyValues.value.plannedMonthly).toBe(300);
    edits.value.monthly = null;
    expect(applyValues.value.plannedMonthly).toBeNull();
    edits.value.monthly = 0;
    expect(applyValues.value.plannedMonthly).toBeNull();
  });

  it('drops accounts whose share is 0 or empty from the applied values', () => {
    const { setShare, applyValues } = setup();
    setShare({ accountId: id('a'), value: 0 });
    setShare({ accountId: id('b'), value: null });
    expect(applyValues.value.accounts).toEqual([]);
    setShare({ accountId: id('b'), value: 25 });
    expect(applyValues.value.accounts).toEqual([{ accountId: id('b'), sharePercent: 25 }]);
  });

  it('is not dirty after a reset', () => {
    const { setShare, isDirty, reset } = setup();
    setShare({ accountId: id('a'), value: 40 });
    expect(isDirty.value).toBe(true);
    reset();
    expect(isDirty.value).toBe(false);
  });

  it('resets the sandbox only when the goal is saved', async () => {
    const goal = buildGoal();
    const { goalRef, edits, setShare } = setup({ goal });
    setShare({ accountId: id('a'), value: 40 });

    goalRef.value = { ...goal, name: 'Refetched' };
    await nextTick();
    expect(edits.value.shares[id('a')]).toBe(40);

    goalRef.value = { ...goal, updatedAt: '2026-10-20T00:00:00.000Z' };
    await nextTick();
    expect(edits.value.shares[id('a')]).toBe(60);
  });

  it("caps a share by other goals' holdings, not the goal's own", () => {
    const goal = buildGoal();
    const other = buildGoal({ id: id('other'), name: 'Trip', accounts: [{ accountId: id('a'), sharePercent: 30 }] });
    const { shareCapacity, setShare, isOverMax, hasShareError, applyValues } = setup({ goal, goals: [goal, other] });
    expect(shareCapacity({ accountId: id('a') })?.max).toBe(70);

    setShare({ accountId: id('a'), value: 80 });
    expect(isOverMax({ accountId: id('a') })).toBe(true);
    expect(hasShareError.value).toBe(true);
    expect(applyValues.value.accounts).toContainEqual({ accountId: id('a'), sharePercent: 70 });

    setShare({ accountId: id('a'), value: 70 });
    expect(hasShareError.value).toBe(false);
  });

  it('has no cap and no share error while the goals list is not loaded', () => {
    const { shareCapacity, setShare, hasShareError } = setup({ goals: null });
    expect(shareCapacity({ accountId: id('a') })).toBeNull();
    setShare({ accountId: id('a'), value: 80 });
    expect(hasShareError.value).toBe(false);
  });
});

describe('getMonthlySliderRange', () => {
  it('rounds twice the largest monthly figure up to its magnitude', () => {
    expect(getMonthlySliderRange({ amounts: [9800, 9400, null], remaining: 0 })).toEqual({ max: 20000, step: 200 });
  });

  it('falls back to a year of the remainder when no monthly figure exists', () => {
    expect(getMonthlySliderRange({ amounts: [null], remaining: 24000 })).toEqual({ max: 2000, step: 20 });
  });

  it('never returns a zero range', () => {
    expect(getMonthlySliderRange({ amounts: [], remaining: 0 })).toEqual({ max: 1000, step: 10 });
  });
});
