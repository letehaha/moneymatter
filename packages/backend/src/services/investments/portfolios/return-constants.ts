/**
 * Minimum tracked history (in days) before an annualized figure is shown.
 * Annualizing a return from a few weeks of data inflates noise into a wild
 * yearly number, so anything shorter is reported as "not enough history".
 */
export const MIN_HISTORY_DAYS = 180;
