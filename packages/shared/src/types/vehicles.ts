/**
 * Vehicle body / drivetrain class used to pick the default depreciation curve.
 * VARCHAR in DB, TS-side enum for type safety (per project's no-DB-enums rule).
 */
export enum VEHICLE_CLASS {
  sedan = 'sedan',
  suv = 'suv',
  truck = 'truck',
  luxury = 'luxury',
  ev = 'ev',
  motorcycle = 'motorcycle',
  other = 'other',
}

/**
 * How a vehicle's depreciation is parameterized:
 * - classDefault: use the per-class default curve as-is.
 * - slow / average / fast: scale the per-class default curve by a preset multiplier.
 * - custom: ignore class curve, apply a single flat annual rate (customAnnualRatePct).
 */
export enum DEPRECIATION_PRESET {
  classDefault = 'class-default',
  slow = 'slow',
  average = 'average',
  fast = 'fast',
  custom = 'custom',
}

/**
 * Default annual depreciation rates (percent) by year-since-purchase, indexed
 * per vehicle class. Year 0 = the first year of ownership. Numbers approximate
 * widely-published averages (Iseecars / Edmunds 5-year reports). Adjust here
 * when better data is available.
 *
 * After the array end, callers fall back to TAIL_RATE_PCT.
 *
 * Lives in the shared package so backend (`compute-vehicle-value.ts`) and
 * frontend (depreciation chart) share one source of truth — divergence would
 * silently make the chart disagree with the headline value.
 */
export const CLASS_DEFAULT_CURVES: Record<VEHICLE_CLASS, number[]> = {
  [VEHICLE_CLASS.sedan]: [20, 15, 12, 10, 8, 7, 6, 5, 5, 4],
  [VEHICLE_CLASS.suv]: [18, 14, 11, 10, 8, 7, 6, 5, 5, 4],
  [VEHICLE_CLASS.truck]: [15, 12, 10, 9, 8, 7, 6, 5, 5, 4],
  [VEHICLE_CLASS.luxury]: [25, 18, 14, 12, 10, 8, 7, 6, 5, 5],
  [VEHICLE_CLASS.ev]: [22, 17, 13, 10, 8, 7, 6, 5, 5, 4],
  [VEHICLE_CLASS.motorcycle]: [20, 15, 12, 10, 8, 7, 6, 5, 5, 4],
  [VEHICLE_CLASS.other]: [20, 15, 12, 10, 8, 7, 6, 5, 5, 4],
};

/** Annual rate applied beyond the explicit curve. */
export const TAIL_RATE_PCT = 4;

/**
 * Multipliers applied to the per-class default curve for the slow / average /
 * fast presets. `average` is identity (1.0).
 */
export const PRESET_MULTIPLIERS = {
  slow: 0.7,
  average: 1.0,
  fast: 1.3,
} as const;
