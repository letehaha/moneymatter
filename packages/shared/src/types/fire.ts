export const FIRE_TARGET_TYPES = ['lean', 'regular', 'fat'] as const;

export type FireTargetType = (typeof FIRE_TARGET_TYPES)[number];

export interface FireSettings {
  annualSpendingOverride?: number | null;
  monthlyContributionOverride?: number | null;
  spendingExcludedCategoryIds?: string[];
  includeVentures?: boolean;
  includeVehicles?: boolean;
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
  /** `yyyy-MM` month the pace is measured against; unset means the month a year ago. */
  paceAnchor?: string | null;
}

/** FIRE settings as they stood at the end of `month` (`yyyy-MM`), written server-side on each change. */
export interface FireSettingsSnapshot {
  month: string;
  fire: FireSettings;
}

/** Month of the snapshot holding the settings from before history was recorded; sorts before every real month. */
export const FIRE_HISTORY_BASELINE_MONTH = '0000-00';

export const FIRE_HISTORY_MAX_ENTRIES = 120;

/** View choices, not plan assumptions: never recorded in history, and the pace comparison always uses the current ones. */
export const FIRE_VIEW_KEYS = ['paceAnchor', 'targetType'] as const satisfies readonly (keyof FireSettings)[];

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
