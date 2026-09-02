/**
 * Valuation parameters for real-estate accounts.
 *
 * Unlike vehicles, a property has no per-type curve: its value follows a single
 * signed annual rate that compounds continuously from the anchor. Lives in the
 * shared package so backend (`compute-property-value.ts`) and frontend
 * (appreciation chart) share one source of truth — divergence would silently
 * make the chart disagree with the headline value.
 */

export enum PROPERTY_TYPE {
  house = 'house',
  apartment = 'apartment',
  condo = 'condo',
  townhouse = 'townhouse',
  land = 'land',
  commercial = 'commercial',
  industrial = 'industrial',
  vacation = 'vacation',
  other = 'other',
}

/** Applied when the user does not supply a rate. Roughly long-run housing inflation. */
export const DEFAULT_ANNUAL_APPRECIATION_RATE_PCT = 3;

/**
 * Bounds on `annualAppreciationRatePct`. Negative rates are legitimate — they
 * model a declining market — so the range is symmetric. The magnitude cap keeps
 * a typo (300 instead of 3) from projecting an absurd balance into net worth.
 */
export const MIN_ANNUAL_APPRECIATION_RATE_PCT = -20;
export const MAX_ANNUAL_APPRECIATION_RATE_PCT = 20;
