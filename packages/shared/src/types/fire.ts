export const FIRE_TARGET_TYPES = ['lean', 'regular', 'fat'] as const;

export type FireTargetType = (typeof FIRE_TARGET_TYPES)[number];

export interface FireSettings {
  annualSpendingOverride?: number | null;
  monthlyContributionOverride?: number | null;
  spendingExcludedCategoryIds?: string[];
  includeVentures?: boolean;
  includeVehicles?: boolean;
  includeProperties?: boolean;
  includeLoans?: boolean;
  returnIndicatorId?: string;
  customReturnPct?: number | null;
  inflationPct?: number;
  withdrawalRatePct?: number;
  leanMultiplier?: number;
  fatMultiplier?: number;
  baristaMonthlyIncome?: number | null;
  birthYear?: number | null;
  coastTargetAge?: number;
  targetType?: FireTargetType;
}

/** Amounts denominated in the user's base currency, converted when it changes. */
export const FIRE_AMOUNT_KEYS = [
  'annualSpendingOverride',
  'monthlyContributionOverride',
  'baristaMonthlyIncome',
] as const satisfies readonly (keyof FireSettings)[];

/** Return-indicator ids backed by one of the user's portfolios are `portfolio:<portfolioId>`. */
const PORTFOLIO_INDICATOR_PREFIX = 'portfolio:';

export const makePortfolioIndicatorId = ({ portfolioId }: { portfolioId: string }): string =>
  `${PORTFOLIO_INDICATOR_PREFIX}${portfolioId}`;

export const isPortfolioIndicatorId = ({ id }: { id: string }): boolean => id.startsWith(PORTFOLIO_INDICATOR_PREFIX);

export const getPortfolioIdFromIndicatorId = ({ id }: { id: string }): string =>
  id.slice(PORTFOLIO_INDICATOR_PREFIX.length);

export const FIRE_LIMITS = {
  customReturnPct: { min: -10, max: 30 },
  inflationPct: { min: 0, max: 30 },
  withdrawalRatePct: { min: 1, max: 10 },
  leanMultiplier: { min: 0.3, max: 1 },
  fatMultiplier: { min: 1, max: 5 },
  coastTargetAge: { min: 30, max: 100 },
  birthYear: { min: 1900, max: 2100 },
} as const;

export const FIRE_DEFAULTS = {
  includeVentures: false,
  includeVehicles: false,
  includeProperties: false,
  includeLoans: false,
  returnIndicatorId: 'world-stock',
  inflationPct: 3,
  withdrawalRatePct: 4,
  leanMultiplier: 0.7,
  fatMultiplier: 1.5,
  coastTargetAge: 65,
  targetType: 'regular',
} as const satisfies FireSettings;

export const FIRE_MAX_EXCLUDED_CATEGORIES = 50;
