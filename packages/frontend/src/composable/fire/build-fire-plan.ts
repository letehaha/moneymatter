import {
  ACCOUNT_CATEGORIES,
  FIRE_TARGET_TYPES,
  type FireTargetType,
  type NetWorthHistoryPoint,
  type GetNetWorthHistoryResponse,
  type CashFlowPeriodData,
  type GetVentureContributionsResponse,
} from '@bt/shared/types';
import { addMonths, differenceInCalendarMonths, parseISO } from 'date-fns';
import { sum } from 'lodash-es';

import { FIRE_SEED_MIN_MONTHS, deriveFireSeed } from './derive-fire-seed';
import {
  ageAt,
  coastNumber,
  isReached,
  monthlyIncomeFrom,
  progressRatio,
  requiredMonthlyContribution,
  simulate,
  typeTargets,
} from './fire-math';
import type { FireReturnFallback, ResolvedFireSettings } from './resolve-fire-settings';

const RANGE_SPREAD = 0.02;
export const UNREACHABLE_PMT_MONTHS = 240;
const SHORT_RETURN_HISTORY_DAYS = 1095;

export type FirePlanStatus = 'loading' | 'no-data' | 'needs-spending' | 'ready' | 'reached' | 'unreachable';

export type FireWarning =
  | 'contribution-clamped'
  | 'return-below-inflation'
  | 'portfolio-short-history'
  | FireReturnFallback
  | 'history-degraded';

const CHIP_KEYS = [...FIRE_TARGET_TYPES, 'barista', 'coast'] as const;

export type FireChipKey = (typeof CHIP_KEYS)[number];

export type FireChipStatus =
  | 'eta'
  | 'reached'
  | 'needs-input'
  | 'past-coast-age'
  | 'not-meaningful'
  | 'unreachable'
  | 'waiting-spending';

export type FireChip = {
  key: FireChipKey;
  status: FireChipStatus;
  amount: number | null;
  hitMonth: number | null;
  date: Date | null;
};

type FireThresholdKey = 'pct25' | 'pct50' | 'pct75' | 'target' | FireTargetType | 'barista';

type FireBuckets = Record<'accounts' | 'portfolios' | 'ventures' | 'vehicles' | 'loans', number>;

type FireSeed = ReturnType<typeof deriveFireSeed>;

export type FireInputs = {
  buckets: FireBuckets;
  balance: number;
  spending: number | null;
  spendingIsAuto: boolean;
  contribution: number;
  contributionIsAuto: boolean;
  seed: FireSeed;
  monthlyIncome: number;
};

export type FireMilestone = {
  pct: 25 | 50 | 75 | 100;
  amount: number;
  hitMonth: number | null;
  date: Date | null;
  reached: boolean;
};

export type FireChartPoint = { date: Date; value: number };

export type FireChart = {
  history: FireChartPoint[];
  projection: FireChartPoint[];
  rangeHigh: FireChartPoint[] | null;
  rangeLow: FireChartPoint[] | null;
  targetLine: number;
  milestoneMonths: { pct: number; month: number }[];
  fireMonth: number | null;
};

export type FireDatedMonths = { months: number; date: Date };

export type FirePlan = {
  status: FirePlanStatus;
  inputs: FireInputs;
  target: number | null;
  nextGoal: FireTargetType | null;
  progress: number | null;
  eta: (FireDatedMonths & { ageAtDate: number | null }) | null;
  range: { earliest: FireDatedMonths; latest: FireDatedMonths | null } | null;
  milestones: FireMilestone[];
  nextMilestone: FireMilestone | null;
  chips: FireChip[];
  chart: FireChart | null;
  warnings: FireWarning[];
  reached: { monthlyIncome: number; pctOfSpending: number | null } | null;
  unreachable: { requiredMonthlyContribution: number } | null;
};

const MILESTONES = [
  { pct: 25, key: 'pct25' },
  { pct: 50, key: 'pct50' },
  { pct: 75, key: 'pct75' },
  { pct: 100, key: 'target' },
] as const;
const ZERO_BUCKETS: FireBuckets = {
  accounts: 0,
  portfolios: 0,
  ventures: 0,
  vehicles: 0,
  loans: 0,
};

const toFireBuckets = ({ point }: { point: NetWorthHistoryPoint }): FireBuckets => ({
  accounts:
    point.assets.cash +
    point.liabilities[ACCOUNT_CATEGORIES.creditCard] +
    point.liabilities[ACCOUNT_CATEGORIES.overdraft],
  portfolios: point.assets.investments,
  ventures: point.assets.ventures,
  vehicles: point.assets.vehicles,
  loans: point.liabilities[ACCOUNT_CATEGORIES.loan],
});

const includedValues = ({ buckets, settings }: { buckets: FireBuckets; settings: ResolvedFireSettings }) => [
  buckets.accounts,
  buckets.portfolios,
  ...(settings.includeVentures ? [buckets.ventures] : []),
  ...(settings.includeVehicles ? [buckets.vehicles] : []),
  ...(settings.includeLoans ? [buckets.loans] : []),
];

export const buildFirePlan = ({
  settings,
  history,
  cashFlowPeriods,
  filteredCashFlowPeriods,
  ventureContributions,
  hasOwnedAccounts,
  isLoading,
  now,
}: {
  settings: ResolvedFireSettings;
  history: GetNetWorthHistoryResponse | undefined;
  cashFlowPeriods: CashFlowPeriodData[];
  filteredCashFlowPeriods: CashFlowPeriodData[];
  ventureContributions: GetVentureContributionsResponse;
  hasOwnedAccounts: boolean;
  isLoading: boolean;
  now: Date;
}): FirePlan => {
  const allPoints = history?.points ?? [];
  const lastPoint = allPoints[allPoints.length - 1];
  const buckets = lastPoint ? toFireBuckets({ point: lastPoint }) : ZERO_BUCKETS;
  const firstActive = allPoints.findIndex((point) =>
    includedValues({ buckets: toFireBuckets({ point }), settings }).some((v) => v !== 0),
  );
  const points = firstActive === -1 ? [] : allPoints.slice(firstActive);

  const included = includedValues({ buckets, settings });
  const assets = sum(included.filter((v) => v > 0));
  const liabilities = sum(included.filter((v) => v < 0).map((v) => -v));
  const balance = assets - liabilities;

  // excludedCategoryIds drops excluded split legs and keeps cross-category refunds netted,
  // so the gap to the unfiltered call is exactly the excluded spend.
  const filteredExpenses = new Map(filteredCashFlowPeriods.map((p) => [p.periodStart, p.expenses]));
  const excludedCategoryExpenseByPeriod = Object.fromEntries(
    cashFlowPeriods.map((p) => [p.periodStart, p.expenses - (filteredExpenses.get(p.periodStart) ?? p.expenses)]),
  );
  const seed = deriveFireSeed({
    periods: cashFlowPeriods,
    excludedCategoryExpenseByPeriod,
    ventureContributions: settings.includeVentures ? [] : ventureContributions,
    now,
  });
  const spending = settings.annualSpendingOverride ?? seed.spending;
  const contribution = settings.monthlyContributionOverride ?? seed.contribution;
  const coastMonths =
    settings.birthYear === null
      ? null
      : Math.round((settings.coastTargetAge - ageAt({ birthYear: settings.birthYear, date: now })) * 12);

  const warnings: FireWarning[] = [];
  if (seed.contributionWasNegative && settings.monthlyContributionOverride === null)
    warnings.push('contribution-clamped');
  if (settings.realAnnual <= 0) warnings.push('return-below-inflation');
  if (settings.returnFallback !== null) warnings.push(settings.returnFallback);
  if (settings.returnPeriodDays !== null && settings.returnPeriodDays < SHORT_RETURN_HISTORY_DAYS)
    warnings.push('portfolio-short-history');
  if (history?.degraded) warnings.push('history-degraded');

  const inputs: FireInputs = {
    buckets,
    balance,
    spending,
    spendingIsAuto: settings.annualSpendingOverride === null,
    contribution,
    contributionIsAuto: settings.monthlyContributionOverride === null && seed.monthsUsed >= FIRE_SEED_MIN_MONTHS,
    seed,
    monthlyIncome: monthlyIncomeFrom({ balance, withdrawalRatePct: settings.withdrawalRatePct }),
  };

  const earlyStatus: FirePlanStatus | null = isLoading
    ? 'loading'
    : (!hasOwnedAccounts || points.length === 0) && settings.annualSpendingOverride === null
      ? 'no-data'
      : null;

  if (earlyStatus !== null || spending === null) {
    return {
      status: earlyStatus ?? 'needs-spending',
      inputs,
      target: null,
      nextGoal: null,
      progress: null,
      eta: null,
      range: null,
      milestones: [],
      nextMilestone: null,
      chips: CHIP_KEYS.map((key) => ({
        key,
        status: 'waiting-spending',
        amount: null,
        hitMonth: null,
        date: null,
      })),
      chart: null,
      warnings,
      reached: null,
      unreachable: null,
    };
  }

  const { withdrawalRatePct, realAnnual } = settings;
  const targets = typeTargets({
    annualSpending: spending,
    withdrawalRatePct,
    leanMultiplier: settings.leanMultiplier,
    fatMultiplier: settings.fatMultiplier,
    baristaMonthlyIncome: settings.baristaMonthlyIncome,
  });
  const target = targets[settings.targetType];
  const milestoneDefs = MILESTONES.map(({ pct, key }) => ({ pct, key, amount: (target * pct) / 100 }));
  const thresholdDefs: { key: FireThresholdKey; amount: number }[] = [
    ...milestoneDefs,
    ...FIRE_TARGET_TYPES.map((key) => ({ key, amount: targets[key] })),
    ...(targets.barista === null ? [] : [{ key: 'barista' as const, amount: targets.barista }]),
  ];
  const thresholdKeys = thresholdDefs.map((d) => d.key);
  const targetThresholdIndex = thresholdKeys.indexOf('target');
  const runSim = ({ annual }: { annual: number }) =>
    simulate({
      assets,
      liabilities,
      monthlyContribution: contribution,
      realAnnual: annual,
      thresholds: thresholdDefs.map((d) => d.amount + liabilities),
      coastMonths,
      coastThresholdIndex: targetThresholdIndex,
    });

  const base = runSim({ annual: realAnnual });
  const hitMonthOf = ({ key }: { key: FireThresholdKey }) => base.hitMonth[thresholdKeys.indexOf(key)] ?? null;
  const dated = ({ months }: { months: number }): FireDatedMonths => ({
    months,
    date: addMonths(now, months),
  });
  const dateOf = ({ months }: { months: number | null }) => (months === null ? null : addMonths(now, months));

  const targetHit = hitMonthOf({ key: 'target' });
  const isFi = isReached({ balance, target });
  const showRange = !isFi && targetHit !== null;
  const high = showRange ? runSim({ annual: realAnnual + RANGE_SPREAD }) : null;
  const low = showRange ? runSim({ annual: realAnnual - RANGE_SPREAD }) : null;
  const highHit = high?.hitMonth[targetThresholdIndex] ?? null;
  const lowHit = low?.hitMonth[targetThresholdIndex] ?? null;
  const nextGoal = isFi
    ? (FIRE_TARGET_TYPES.slice(FIRE_TARGET_TYPES.indexOf(settings.targetType) + 1).find(
        (type) => !isReached({ balance, target: targets[type] }),
      ) ?? null)
    : null;

  const toPoints = ({ series }: { series: number[] }) => series.map((value, m) => ({ date: addMonths(now, m), value }));
  const nominalHistory = points.map((point) => ({
    date: parseISO(point.date),
    nominal: sum(includedValues({ buckets: toFireBuckets({ point }), settings })),
  }));
  // A leading flat run is the balance before any tracked activity (e.g. an initial balance), not history.
  const historyStart = nominalHistory.findIndex(({ nominal }, i) => nominal !== nominalHistory[i + 1]?.nominal);
  const chartHistory = nominalHistory.slice(Math.max(historyStart, 0)).map(({ date, nominal }) => ({
    date,
    value: nominal * Math.pow(1 + settings.effectiveInflationPct / 100, differenceInCalendarMonths(now, date) / 12),
  }));

  // A series that already starts at or above the amount crossed it before history begins, so no date.
  const crossedAt = ({ amount }: { amount: number }): Date | null => {
    const idx = chartHistory.findIndex(({ value }) => value >= amount);
    return idx > 0 ? chartHistory[idx]!.date : null;
  };

  const milestones: FireMilestone[] = milestoneDefs.map(({ pct, key, amount }) => {
    const hitMonth = hitMonthOf({ key });
    const reached = isReached({ balance, target: amount });
    return {
      pct,
      amount,
      hitMonth,
      date: reached ? crossedAt({ amount }) : dateOf({ months: hitMonth }),
      reached,
    };
  });

  const statusFor = ({ reached, hitMonth }: { reached: boolean; hitMonth: number | null }): FireChipStatus => {
    if (reached) return 'reached';
    return hitMonth === null ? 'unreachable' : 'eta';
  };
  const chip = ({
    key,
    amount = null,
    hitMonth = null,
    status,
  }: {
    key: FireChipKey;
    amount?: number | null;
    hitMonth?: number | null;
    status?: FireChipStatus;
  }): FireChip => ({
    key,
    amount,
    hitMonth,
    date: dateOf({ months: hitMonth }),
    status: status ?? statusFor({ reached: amount !== null && isReached({ balance, target: amount }), hitMonth }),
  });
  const coastChip = (): FireChip => {
    if (coastMonths !== null && coastMonths <= 0) return chip({ key: 'coast', status: 'past-coast-age' });
    if (realAnnual <= 0) return chip({ key: 'coast', status: 'not-meaningful' });
    if (coastMonths === null) return chip({ key: 'coast', status: 'needs-input' });
    return chip({
      key: 'coast',
      amount:
        coastNumber({ target: target + liabilities, realAnnual, yearsToCoastAge: coastMonths / 12 }) - liabilities,
      hitMonth: base.coastHitMonth,
      status: statusFor({ reached: base.coastHitMonth === 0, hitMonth: base.coastHitMonth }),
    });
  };
  const chips: FireChip[] = [
    ...FIRE_TARGET_TYPES.map((key) => chip({ key, amount: targets[key], hitMonth: hitMonthOf({ key }) })),
    targets.barista === null
      ? chip({ key: 'barista', status: 'needs-input' })
      : chip({ key: 'barista', amount: targets.barista, hitMonth: hitMonthOf({ key: 'barista' }) }),
    coastChip(),
  ];

  return {
    status: isFi ? 'reached' : targetHit === null ? 'unreachable' : 'ready',
    inputs,
    target,
    nextGoal,
    progress: progressRatio({ balance, target }),
    eta:
      targetHit === null
        ? null
        : {
            ...dated({ months: targetHit }),
            ageAtDate:
              settings.birthYear === null
                ? null
                : ageAt({
                    birthYear: settings.birthYear,
                    date: addMonths(now, targetHit),
                  }),
          },
    range:
      showRange && highHit !== null
        ? {
            earliest: dated({ months: highHit }),
            latest: lowHit === null ? null : dated({ months: lowHit }),
          }
        : null,
    milestones,
    nextMilestone: milestones.find((m) => !m.reached) ?? null,
    chips,
    chart: {
      history: chartHistory,
      projection: toPoints({ series: base.series }),
      rangeHigh: high === null ? null : toPoints({ series: high.series }),
      rangeLow: low === null ? null : toPoints({ series: low.series }),
      targetLine: target,
      milestoneMonths: milestones.flatMap(({ pct, hitMonth }) =>
        pct < 100 && hitMonth !== null ? [{ pct, month: hitMonth }] : [],
      ),
      fireMonth: targetHit,
    },
    warnings,
    reached: isFi
      ? {
          monthlyIncome: inputs.monthlyIncome,
          pctOfSpending: spending > 0 ? ((inputs.monthlyIncome * 12) / spending) * 100 : null,
        }
      : null,
    unreachable:
      !isFi && targetHit === null
        ? {
            requiredMonthlyContribution: requiredMonthlyContribution({
              balance: assets,
              target: target + liabilities,
              realAnnual,
              months: UNREACHABLE_PMT_MONTHS,
            }),
          }
        : null,
  };
};
