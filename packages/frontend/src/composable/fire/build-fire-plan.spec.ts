import {
  ACCOUNT_CATEGORIES,
  type FireSettings,
  type NetWorthHistoryPoint,
  type CashFlowPeriodData,
  type GetVentureContributionsResponse,
} from '@bt/shared/types';
import type { PortfolioAnnualizedReturnModel } from '@bt/shared/types/investments/portfolio-annualized-return.model';
import { parseISO } from 'date-fns';
import { describe, expect, it } from 'vitest';

import { UNREACHABLE_PMT_MONTHS, buildFirePlan } from './build-fire-plan';
import { toRealAnnual } from './fire-math';
import { resolveFireSettings } from './resolve-fire-settings';

const NOW = new Date(2026, 8, 24);

const point = ({
  date = '2026-09-24',
  cash = 0,
  investments = 0,
  vehicles = 0,
  ventures = 0,
  creditCard = 0,
  overdraft = 0,
  loan = 0,
}: {
  date?: string;
  cash?: number;
  investments?: number;
  vehicles?: number;
  ventures?: number;
  creditCard?: number;
  overdraft?: number;
  loan?: number;
}): NetWorthHistoryPoint => ({
  date,
  assets: { cash, investments, vehicles, ventures },
  assetsTotal: cash + investments + vehicles + ventures,
  liabilities: {
    [ACCOUNT_CATEGORIES.creditCard]: creditCard,
    [ACCOUNT_CATEGORIES.overdraft]: overdraft,
    [ACCOUNT_CATEGORIES.loan]: loan,
  },
  liabilitiesTotal: creditCard + overdraft + loan,
  netWorth: cash + investments + vehicles + ventures + creditCard + overdraft + loan,
});

const cashFlowPeriods = ({ months, expenses = 3_000 }: { months: number; expenses?: number }): CashFlowPeriodData[] =>
  Array.from({ length: months }, (_, idx) => {
    const month = String(idx + 1).padStart(2, '0');
    return {
      periodStart: `2026-${month}-01`,
      periodEnd: `2026-${month}-28`,
      income: 5_000,
      expenses,
      netFlow: 5_000 - expenses,
    };
  });

const build = ({
  fire = {},
  points = [point({ investments: 100_000 })],
  periods = [],
  filteredPeriods = [],
  ventureContributions = [],
  hasOwnedAccounts = true,
  isLoading = false,
  portfolioReturns = [],
}: {
  fire?: FireSettings;
  points?: NetWorthHistoryPoint[];
  periods?: CashFlowPeriodData[];
  filteredPeriods?: CashFlowPeriodData[];
  ventureContributions?: GetVentureContributionsResponse;
  hasOwnedAccounts?: boolean;
  isLoading?: boolean;
  portfolioReturns?: PortfolioAnnualizedReturnModel[];
}) =>
  buildFirePlan({
    settings: resolveFireSettings({
      fire,
      portfolioReturns,
    }),
    history: { points },
    cashFlowPeriods: periods,
    filteredCashFlowPeriods: filteredPeriods,
    ventureContributions,
    hasOwnedAccounts,
    isLoading,
    now: NOW,
  });

const READY = {
  annualSpendingOverride: 40_000,
  monthlyContributionOverride: 2_000,
};

describe('buildFirePlan status', () => {
  it('loading wins over everything', () => {
    expect(build({ fire: READY, isLoading: true }).status).toBe('loading');
  });

  it('no-data without owned accounts or history, unless spending is overridden', () => {
    expect(build({ hasOwnedAccounts: false }).status).toBe('no-data');
    expect(build({ points: [point({})] }).status).toBe('no-data');
    expect(build({ points: [], fire: READY }).status).toBe('ready');
  });

  it('needs-spending when under 3 months of cash flow and no override', () => {
    const plan = build({ periods: cashFlowPeriods({ months: 2 }) });
    expect(plan.status).toBe('needs-spending');
    expect(plan.chips.every((c) => c.status === 'waiting-spending')).toBe(true);
  });

  it('needs-spending, not reached, when the seeded months have no expenses', () => {
    const periods = cashFlowPeriods({ months: 4 }).map((p) => ({ ...p, expenses: 0 }));
    const plan = build({ periods });
    expect(plan.inputs.seed.monthsUsed).toBe(4);
    expect(plan.status).toBe('needs-spending');
  });

  it('seeds spending from cash flow when nothing is excluded', () => {
    expect(build({ periods: cashFlowPeriods({ months: 8 }) }).inputs.spending).toBe(36_000);
  });

  it('seeds spending from cash flow minus excluded categories', () => {
    const plan = build({
      periods: cashFlowPeriods({ months: 8 }),
      filteredPeriods: cashFlowPeriods({ months: 8, expenses: 2_000 }),
    });
    expect(plan.inputs.spending).toBe(24_000);
    expect(plan.inputs.contribution).toBe(2_000);
    expect(plan.status).toBe('ready');
  });

  it('counts a month in full when the filtered cash flow has no row for it', () => {
    const plan = build({
      periods: cashFlowPeriods({ months: 8 }),
      filteredPeriods: cashFlowPeriods({ months: 4, expenses: 2_000 }),
    });
    expect(plan.inputs.spending).toBe(30_000);
  });

  it('subtracts venture contributions from the seeded contribution unless ventures are included', () => {
    const args = {
      periods: cashFlowPeriods({ months: 8 }),
      ventureContributions: [{ dealId: 'a', name: 'A', amount: 8_000 }],
    };
    expect(build(args).inputs.contribution).toBe(1_000);
    expect(build({ ...args, fire: { includeVentures: true } }).inputs.contribution).toBe(2_000);
  });

  it('ready with eta, range bracketing the base run', () => {
    const plan = build({ fire: READY });
    expect(plan.status).toBe('ready');
    const { eta, range } = plan;
    expect(eta).not.toBeNull();
    expect(range).not.toBeNull();
    expect(range!.earliest.months).toBeLessThanOrEqual(eta!.months);
    expect(range!.latest!.months).toBeGreaterThanOrEqual(eta!.months);
    expect(plan.chart!.rangeHigh).not.toBeNull();
  });

  it('reached hides the range and reports supported income', () => {
    const plan = build({
      fire: READY,
      points: [point({ investments: 1_200_000 })],
    });
    expect(plan.status).toBe('reached');
    expect(plan.range).toBeNull();
    expect(plan.chart!.rangeHigh).toBeNull();
    expect(plan.chart!.rangeLow).toBeNull();
    expect(plan.reached).toEqual({ monthlyIncome: 4_000, pctOfSpending: 120 });
  });

  it('unreachable with zero balance and zero contribution, with a 20-year PMT', () => {
    const plan = build({
      fire: { annualSpendingOverride: 40_000, monthlyContributionOverride: 0 },
      points: [],
    });
    expect(plan.status).toBe('unreachable');
    expect(plan.eta).toBeNull();
    expect(plan.range).toBeNull();
    // Future value of an annuity from zero: T · i / ((1 + i)^n − 1).
    const i = Math.pow(1 + toRealAnnual({ nominalPct: 8, inflationPct: 3 }), 1 / 12) - 1;
    expect(plan.unreachable!.requiredMonthlyContribution).toBeCloseTo(
      (1_000_000 * i) / (Math.pow(1 + i, UNREACHABLE_PMT_MONTHS) - 1),
      6,
    );
  });

  it('prices the unreachable PMT on assets against target plus included loans', () => {
    const plan = build({
      fire: { annualSpendingOverride: 40_000, monthlyContributionOverride: 0, includeLoans: true },
      points: [point({ investments: 100_000, loan: -300_000 })],
    });
    expect(plan.status).toBe('unreachable');
    const i = Math.pow(1 + toRealAnnual({ nominalPct: 8, inflationPct: 3 }), 1 / 12) - 1;
    const growth = Math.pow(1 + i, UNREACHABLE_PMT_MONTHS);
    expect(plan.unreachable!.requiredMonthlyContribution).toBeCloseTo(
      ((1_300_000 - 100_000 * growth) * i) / (growth - 1),
      6,
    );
  });
});

describe('buildFirePlan warnings', () => {
  it('flags a clamped negative seeded contribution unless it is overridden', () => {
    const periods = cashFlowPeriods({ months: 8, expenses: 6_000 });
    expect(build({ periods }).warnings).toContain('contribution-clamped');
    expect(build({ periods, fire: { monthlyContributionOverride: 500 } }).warnings).not.toContain(
      'contribution-clamped',
    );
  });

  it('flags a real return at or below zero', () => {
    const fire = { ...READY, returnIndicatorId: 'custom', customReturnPct: 2, inflationPct: 3 };
    expect(build({ fire }).warnings).toContain('return-below-inflation');
    expect(build({ fire: READY }).warnings).not.toContain('return-below-inflation');
  });

  it('flags a portfolio return based on under three years of history', () => {
    const portfolio: PortfolioAnnualizedReturnModel = {
      portfolioId: 'p1',
      portfolioName: 'Main',
      annualizedReturn: 9,
      hasEnoughHistory: true,
      startDate: '2024-01-01',
      periodDays: 800,
      currencyCode: 'USD',
    };
    const fire = { ...READY, returnIndicatorId: 'portfolio:p1' };
    expect(build({ fire, portfolioReturns: [portfolio] }).warnings).toContain('portfolio-short-history');
    expect(build({ fire, portfolioReturns: [{ ...portfolio, periodDays: 1_500 }] }).warnings).not.toContain(
      'portfolio-short-history',
    );
  });

  it('passes the return fallback through', () => {
    expect(build({ fire: { ...READY, returnIndicatorId: 'portfolio:p1' } }).warnings).toContain(
      'portfolio-unavailable',
    );
    expect(build({ fire: { ...READY, returnIndicatorId: 'custom', customReturnPct: null } }).warnings).toContain(
      'custom-missing',
    );
  });
});

describe('buildFirePlan chips', () => {
  const chip = ({ fire, key }: { fire: FireSettings; key: string }) =>
    build({ fire: { ...READY, ...fire } }).chips.find((c) => c.key === key)!;

  it('keeps the fixed order', () => {
    expect(build({ fire: READY }).chips.map((c) => c.key)).toEqual(['lean', 'regular', 'fat', 'barista', 'coast']);
  });

  it('barista needs input without part-time income', () => {
    expect(chip({ fire: {}, key: 'barista' }).status).toBe('needs-input');
    expect(chip({ fire: { baristaMonthlyIncome: 1_000 }, key: 'barista' }).status).toBe('eta');
  });

  it('coast needs a birth year', () => {
    expect(chip({ fire: {}, key: 'coast' }).status).toBe('needs-input');
  });

  it('coast is past coast age once the target age has passed', () => {
    expect(chip({ fire: { birthYear: 1950 }, key: 'coast' }).status).toBe('past-coast-age');
  });

  it('coast is not meaningful at a non-positive real return', () => {
    const fire = {
      birthYear: 1990,
      returnIndicatorId: 'custom',
      customReturnPct: 2,
      inflationPct: 3,
    };
    expect(chip({ fire, key: 'coast' }).status).toBe('not-meaningful');
  });

  it('coast shows an amount and an eta for a young user', () => {
    const coast = chip({ fire: { birthYear: 1990 }, key: 'coast' });
    expect(coast.status).toBe('eta');
    expect(coast.amount).toBeCloseTo(254_930, -1);
    expect(coast.hitMonth).toBe(93);
    expect(coast.hitMonth).toBeLessThanOrEqual(build({ fire: { ...READY, birthYear: 1990 } }).eta!.months);
  });

  it('coast amount nets out included loans, so reached means balance >= amount', () => {
    for (const [investments, status] of [
      [250_000, 'eta'],
      [300_000, 'reached'],
    ] as const) {
      const plan = build({
        fire: { ...READY, birthYear: 1990, includeLoans: true },
        points: [point({ investments, loan: -100_000 })],
      });
      const coast = plan.chips.find((c) => c.key === 'coast')!;
      expect(coast.status).toBe(status);
      expect(coast.status === 'reached').toBe(plan.inputs.balance >= coast.amount!);
    }
  });
});

describe('buildFirePlan milestones', () => {
  it('ascend by pct with non-decreasing hit months', () => {
    const { milestones } = build({
      fire: READY,
      points: [point({ investments: 300_000 })],
    });
    expect(milestones.map((m) => m.pct)).toEqual([25, 50, 75, 100]);
    const months = milestones.map((m) => m.hitMonth!);
    expect([...months].sort((a, b) => a - b)).toEqual(months);
    expect(milestones[0]!.reached).toBe(true);
    expect(milestones[0]!.hitMonth).toBe(0);
    expect(milestones[1]!.reached).toBe(false);
  });

  it('next milestone is the first unreached one, including the target', () => {
    const at = ({ investments }: { investments: number }) =>
      build({ fire: READY, points: [point({ investments })] }).nextMilestone;
    expect(at({ investments: 300_000 })).toMatchObject({ pct: 50, amount: 500_000 });
    expect(at({ investments: 800_000 })).toMatchObject({ pct: 100, amount: 1_000_000 });
    expect(at({ investments: 800_000 })!.hitMonth).not.toBeNull();
    expect(at({ investments: 1_200_000 })).toBeNull();
  });
});

describe('buildFirePlan reached milestone dates', () => {
  const history = ({ values }: { values: number[] }) =>
    values.map((investments, idx) => point({ date: `2026-${String(idx + 1).padStart(2, '0')}-01`, investments }));

  it('dates a reached milestone by the first history month at or above its amount', () => {
    const { milestones } = build({
      fire: { ...READY, inflationPct: 0 },
      points: history({ values: [100_000, 200_000, 260_000, 400_000, 550_000, 550_000, 550_000, 550_000, 600_000] }),
    });
    expect(milestones[0]).toMatchObject({ pct: 25, reached: true, hitMonth: 0 });
    expect(milestones[0]!.date).toEqual(parseISO('2026-03-01'));
    expect(milestones[1]!.date).toEqual(parseISO('2026-05-01'));
    expect(milestones[2]!.reached).toBe(false);
    expect(milestones[2]!.date).not.toBeNull();
  });

  it('compares inflation-adjusted history, so an older month can be the crossing', () => {
    // 246k in Feb is 250k+ in Sep money at 3% inflation; nominally the 250k line is only crossed in Mar.
    const { milestones } = build({
      fire: READY,
      points: history({ values: [100_000, 246_000, 252_000, 400_000, 600_000] }),
    });
    expect(milestones[0]!.date).toEqual(parseISO('2026-02-01'));
  });

  it('has no date when the milestone was already reached before history begins', () => {
    const { milestones } = build({ fire: READY, points: history({ values: [300_000, 320_000] }) });
    expect(milestones[0]).toMatchObject({ reached: true, date: null });
  });

  it('has no date without history, so the current month is never reported as the crossing', () => {
    const { milestones } = build({ fire: READY, points: [point({ investments: 300_000 })] });
    expect(milestones[0]).toMatchObject({ reached: true, date: null });
  });
});

describe('buildFirePlan loans as a threshold shift', () => {
  const fire: FireSettings = {
    annualSpendingOverride: 40_000,
    monthlyContributionOverride: 3_000,
    returnIndicatorId: 'custom',
    customReturnPct: 8,
    inflationPct: 3,
    includeLoans: true,
  };
  const points = [point({ investments: 200_000, loan: -300_000 })];

  it('matches the golden 194 months and the net series crosses the target there', () => {
    const plan = build({ fire, points });
    expect(plan.inputs.balance).toBe(-100_000);
    expect(plan.progress).toBe(0);
    expect(plan.eta!.months).toBe(194);
    const projection = plan.chart!.projection;
    expect(projection[194]!.value).toBeGreaterThanOrEqual(1_000_000);
    expect(projection[193]!.value).toBeLessThan(1_000_000);
  });

  it('ignores loans when not included', () => {
    const plan = build({ fire: { ...fire, includeLoans: false }, points });
    expect(plan.inputs.balance).toBe(200_000);
    expect(plan.eta!.months).toBeLessThan(194);
  });
});

describe('buildFirePlan balance composition', () => {
  const points = [
    point({
      cash: 10_000,
      creditCard: -10_000,
      overdraft: -5_000,
      investments: 100_000,
      vehicles: 20_000,
      ventures: 5_000,
    }),
  ];

  it('nets cards and overdrafts into accounts and honours the vehicle and venture switches', () => {
    const plan = build({ fire: { ...READY, includeVehicles: true }, points });
    expect(plan.inputs.buckets.accounts).toBe(-5_000);
    expect(plan.inputs.balance).toBe(115_000);
    expect(build({ fire: { ...READY, includeVehicles: true, includeVentures: true }, points }).inputs.balance).toBe(
      120_000,
    );
    expect(build({ fire: READY, points }).inputs.balance).toBe(95_000);
  });
});

describe('buildFirePlan history', () => {
  it('trims leading all-zero points and deflates older points', () => {
    const plan = build({
      fire: READY,
      points: [
        point({ date: '2024-09-30' }),
        point({ date: '2025-09-30', investments: 90_000 }),
        point({ date: '2026-09-24', investments: 100_000 }),
      ],
    });
    const history = plan.chart!.history;
    expect(history).toHaveLength(2);
    expect(history[0]!.value).toBeCloseTo(92_700, 0);
    expect(history[1]!.value).toBe(100_000);
  });

  it('starts at the last point of a leading flat run of nominal balances', () => {
    const plan = build({
      fire: READY,
      points: [
        point({ date: '2016-09-30', cash: 50_000 }),
        point({ date: '2020-09-30', cash: 50_000 }),
        point({ date: '2026-06-30', cash: 50_000 }),
        point({ date: '2026-07-31', cash: 60_000 }),
        point({ date: '2026-08-31', cash: 60_000 }),
        point({ date: '2026-09-24', cash: 70_000 }),
      ],
    });
    expect(plan.chart!.history.map((p) => p.date)).toEqual(
      ['2026-06-30', '2026-07-31', '2026-08-31', '2026-09-24'].map((d) => parseISO(d)),
    );
  });

  it('keeps only the latest point when the whole history is flat', () => {
    const plan = build({
      fire: READY,
      points: [point({ date: '2016-09-30', cash: 50_000 }), point({ date: '2026-09-24', cash: 50_000 })],
    });
    expect(plan.chart!.history).toEqual([{ date: parseISO('2026-09-24'), value: 50_000 }]);
  });

  it('warns when the history is degraded', () => {
    const plan = buildFirePlan({
      settings: resolveFireSettings({
        fire: READY,
        portfolioReturns: [],
      }),
      history: {
        points: [point({ investments: 1 })],
        degraded: { fxFallbackCurrencies: ['XYZ'] },
      },
      cashFlowPeriods: [],
      filteredCashFlowPeriods: [],
      ventureContributions: [],
      hasOwnedAccounts: true,
      isLoading: false,
      now: NOW,
    });
    expect(plan.warnings).toContain('history-degraded');
  });
});

describe('buildFirePlan selected target type', () => {
  const TARGETS = { lean: 700_000, regular: 1_000_000, fat: 1_500_000 } as const;
  const forType = ({
    targetType,
    fire = READY,
    points,
  }: {
    targetType?: 'lean' | 'regular' | 'fat';
    fire?: FireSettings;
    points?: NetWorthHistoryPoint[];
  }) => build({ fire: { ...fire, ...(targetType ? { targetType } : {}) }, points });

  it('defaults to Regular', () => {
    const plan = forType({});
    expect(plan.target).toBeCloseTo(TARGETS.regular, 6);
    expect(plan.eta).toEqual(forType({ targetType: 'regular' }).eta);
  });

  it.each(['lean', 'regular', 'fat'] as const)('%s drives eta, progress, milestones and chart', (targetType) => {
    const plan = forType({ targetType });
    const target = TARGETS[targetType];
    const typeChip = plan.chips.find((c) => c.key === targetType)!;

    expect(plan.status).toBe('ready');
    expect(plan.target).toBeCloseTo(target, 6);
    expect(plan.progress).toBeCloseTo(100_000 / target, 12);
    expect(plan.eta!.months).toBe(typeChip.hitMonth);
    expect(plan.milestones.map((m) => m.amount)).toEqual([0.25, 0.5, 0.75, 1].map((share) => target * share));
    expect(plan.milestones.at(-1)!.hitMonth).toBe(typeChip.hitMonth);
    expect(plan.chart!.targetLine).toBeCloseTo(target, 6);
    expect(plan.chart!.fireMonth).toBe(typeChip.hitMonth);
    expect(plan.range!.earliest.months).toBeLessThanOrEqual(plan.eta!.months);
    expect(plan.range!.latest!.months).toBeGreaterThanOrEqual(plan.eta!.months);
    expect(plan.nextGoal).toBeNull();
  });

  it('orders the ETAs lean < regular < fat and keeps every chip on its own target', () => {
    const [lean, regular, fat] = (['lean', 'regular', 'fat'] as const).map((targetType) => forType({ targetType }));
    expect(lean!.eta!.months).toBeLessThan(regular!.eta!.months);
    expect(regular!.eta!.months).toBeLessThan(fat!.eta!.months);
    expect(lean!.chips).toEqual(fat!.chips);
  });

  it('keeps Barista on spending minus part-time income', () => {
    const fire = { ...READY, baristaMonthlyIncome: 1_000 };
    const barista = (targetType: 'lean' | 'fat') =>
      forType({ targetType, fire }).chips.find((c) => c.key === 'barista')!.amount;
    expect(barista('lean')).toBeCloseTo(700_000, 6);
    expect(barista('fat')).toBeCloseTo(700_000, 6);
  });

  it('bases Coast on the selected target', () => {
    const fire = { ...READY, birthYear: 1990 };
    const coast = (targetType: 'lean' | 'regular' | 'fat') => {
      const plan = forType({ targetType, fire });
      return { plan, chip: plan.chips.find((c) => c.key === 'coast')! };
    };
    const regular = coast('regular').chip;
    expect(regular.amount).toBeCloseTo(254_930, -1);
    for (const targetType of ['lean', 'fat'] as const) {
      const { plan, chip } = coast(targetType);
      expect(chip.amount! / regular.amount!).toBeCloseTo(TARGETS[targetType] / TARGETS.regular, 9);
      expect(chip.hitMonth).toBeLessThanOrEqual(plan.eta!.months);
    }
    expect(coast('lean').chip.hitMonth).toBeLessThan(regular.hitMonth!);
    expect(coast('fat').chip.hitMonth).toBeGreaterThan(regular.hitMonth!);
  });

  it('reached follows the selected target, and the next goal is the next larger unreached type', () => {
    const at = ({ investments, targetType }: { investments: number; targetType: 'lean' | 'regular' | 'fat' }) =>
      forType({ targetType, points: [point({ investments })] });

    expect(at({ investments: 800_000, targetType: 'lean' })).toMatchObject({ status: 'reached', nextGoal: 'regular' });
    expect(at({ investments: 800_000, targetType: 'regular' })).toMatchObject({ status: 'ready', nextGoal: null });
    expect(at({ investments: 1_200_000, targetType: 'lean' })).toMatchObject({ status: 'reached', nextGoal: 'fat' });
    expect(at({ investments: 1_200_000, targetType: 'regular' })).toMatchObject({ status: 'reached', nextGoal: 'fat' });
    expect(at({ investments: 1_200_000, targetType: 'fat' })).toMatchObject({ status: 'ready', nextGoal: null });
    expect(at({ investments: 1_600_000, targetType: 'fat' })).toMatchObject({ status: 'reached', nextGoal: null });
    expect(at({ investments: 1_600_000, targetType: 'lean' })).toMatchObject({ status: 'reached', nextGoal: null });
  });

  it('prices the unreachable PMT against the selected target', () => {
    const fire = { annualSpendingOverride: 40_000, monthlyContributionOverride: 0 };
    const pmt = (targetType: 'lean' | 'regular' | 'fat') => {
      const plan = forType({ targetType, fire, points: [] });
      expect(plan.status).toBe('unreachable');
      return plan.unreachable!.requiredMonthlyContribution;
    };
    expect(pmt('lean') / pmt('regular')).toBeCloseTo(0.7, 9);
    expect(pmt('fat') / pmt('regular')).toBeCloseTo(1.5, 9);
  });
});
