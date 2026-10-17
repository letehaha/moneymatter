import { CUSTOM_INDICATOR_ID, getIndicatorById } from '@/pages/analytics/utils/market-indicators';
import {
  FIRE_DEFAULTS,
  FIRE_LIMITS,
  FIRE_TARGET_TYPES,
  type FireSettings,
  getPortfolioIdFromIndicatorId,
  isPortfolioIndicatorId,
} from '@bt/shared/types';
import type { PortfolioAnnualizedReturnModel } from '@bt/shared/types/investments/portfolio-annualized-return.model';

import { toRealAnnual } from './fire-math';

export const PRESET_INFLATION_PCT = 3;

export type FireReturnFallback = 'portfolio-unavailable' | 'custom-missing';

export type ResolvedFireSettings = {
  [K in keyof FireSettings]-?: Exclude<FireSettings[K], undefined>;
} & {
  realAnnual: number;
  effectiveInflationPct: number;
  returnFallback: FireReturnFallback | null;
  returnPeriodDays: number | null;
};

const inLimits = ({ key, value }: { key: keyof typeof FIRE_LIMITS; value: number | null | undefined }) =>
  typeof value === 'number' && value >= FIRE_LIMITS[key].min && value <= FIRE_LIMITS[key].max ? value : null;

const finite = ({ value }: { value: number | null | undefined }) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const nonNegative = ({ value }: { value: number | null | undefined }) => {
  const n = finite({ value });
  return n !== null && n >= 0 ? n : null;
};

export const resolveFireSettings = ({
  fire,
  portfolioReturns,
}: {
  fire: FireSettings | undefined;
  portfolioReturns: PortfolioAnnualizedReturnModel[];
}): ResolvedFireSettings => {
  const f = fire ?? {};
  const settings = {
    annualSpendingOverride: nonNegative({ value: f.annualSpendingOverride }),
    monthlyContributionOverride: finite({ value: f.monthlyContributionOverride }),
    spendingExcludedCategoryIds: f.spendingExcludedCategoryIds ?? [],
    includeVentures: f.includeVentures ?? FIRE_DEFAULTS.includeVentures,
    includeVehicles: f.includeVehicles ?? FIRE_DEFAULTS.includeVehicles,
    includeProperties: f.includeProperties ?? FIRE_DEFAULTS.includeProperties,
    includeLoans: f.includeLoans ?? FIRE_DEFAULTS.includeLoans,
    returnIndicatorId: f.returnIndicatorId ?? FIRE_DEFAULTS.returnIndicatorId,
    customReturnPct: inLimits({
      key: 'customReturnPct',
      value: f.customReturnPct,
    }),
    inflationPct: inLimits({ key: 'inflationPct', value: f.inflationPct }) ?? FIRE_DEFAULTS.inflationPct,
    withdrawalRatePct:
      inLimits({ key: 'withdrawalRatePct', value: f.withdrawalRatePct }) ?? FIRE_DEFAULTS.withdrawalRatePct,
    leanMultiplier: inLimits({ key: 'leanMultiplier', value: f.leanMultiplier }) ?? FIRE_DEFAULTS.leanMultiplier,
    fatMultiplier: inLimits({ key: 'fatMultiplier', value: f.fatMultiplier }) ?? FIRE_DEFAULTS.fatMultiplier,
    baristaMonthlyIncome: nonNegative({ value: f.baristaMonthlyIncome }),
    birthYear: inLimits({ key: 'birthYear', value: f.birthYear }),
    coastTargetAge: inLimits({ key: 'coastTargetAge', value: f.coastTargetAge }) ?? FIRE_DEFAULTS.coastTargetAge,
    targetType: f.targetType && FIRE_TARGET_TYPES.includes(f.targetType) ? f.targetType : FIRE_DEFAULTS.targetType,
  };

  const fromPreset = ({ returnFallback }: { returnFallback: FireReturnFallback | null }) => {
    const preset =
      getIndicatorById({ id: settings.returnIndicatorId }) ??
      getIndicatorById({ id: FIRE_DEFAULTS.returnIndicatorId })!;
    return {
      ...settings,
      realAnnual: toRealAnnual({
        nominalPct: preset.avgAnnualReturn,
        inflationPct: PRESET_INFLATION_PCT,
      }),
      effectiveInflationPct: PRESET_INFLATION_PCT,
      returnFallback,
      returnPeriodDays: null,
    };
  };
  const fromNominal = ({ nominalPct, periodDays }: { nominalPct: number; periodDays: number | null }) => ({
    ...settings,
    realAnnual: toRealAnnual({
      nominalPct,
      inflationPct: settings.inflationPct,
    }),
    effectiveInflationPct: settings.inflationPct,
    returnFallback: null,
    returnPeriodDays: periodDays,
  });

  const id = settings.returnIndicatorId;
  if (isPortfolioIndicatorId({ id })) {
    const portfolioId = getPortfolioIdFromIndicatorId({ id });
    const portfolio = portfolioReturns.find((p) => p.portfolioId === portfolioId);
    if (!portfolio || portfolio.annualizedReturn === null)
      return fromPreset({ returnFallback: 'portfolio-unavailable' });
    return fromNominal({
      nominalPct: portfolio.annualizedReturn,
      periodDays: portfolio.periodDays,
    });
  }
  if (id === CUSTOM_INDICATOR_ID) {
    if (settings.customReturnPct === null) return fromPreset({ returnFallback: 'custom-missing' });
    return fromNominal({
      nominalPct: settings.customReturnPct,
      periodDays: null,
    });
  }
  return fromPreset({ returnFallback: null });
};
