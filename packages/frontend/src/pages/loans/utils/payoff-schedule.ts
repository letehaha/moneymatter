import { addMonths } from 'date-fns';

/**
 * Client-side amortization for the payoff-projection chart: the backend's
 * `computeLoanProjection` returns only summary numbers, and the chart needs a
 * per-month series that recomputes instantly as the user types. Must stay in
 * lockstep with `computeLoanProjection` so the chart matches the Projection
 * card to the minor unit. Monetary inputs/outputs are decimals; iteration runs in
 * integer minor units at the loan currency's `decimals` internally.
 */

/** Payoff-horizon cap in months (100 years, matching the backend loan-term cap). */
const MAX_PROJECTION_MONTHS = 1200;
const MONTHS_PER_YEAR = 12;

/** Banker's rounding — mirrors the backend's per-month interest accrual. */
export function roundHalfToEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  // Exactly halfway — round to the even neighbour.
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Fixed monthly payment that fully amortizes `principal` over `termMonths` —
 * the contractual minimum of a level-payment loan. Null when there is no term.
 */
export function computeMinimumPaymentFromTerm({
  principal,
  interestRate,
  termMonths,
  decimals,
}: {
  principal: number;
  /** APR as percent, e.g. 6 for 6%. */
  interestRate: number;
  termMonths: number | null;
  /** Decimals of the loan currency; the payment is rounded to them. */
  decimals: number;
}): number | null {
  if (!termMonths || termMonths <= 0 || principal <= 0) return null;

  const minorPerUnit = 10 ** decimals;

  if (interestRate === 0) {
    return Math.round((principal / termMonths) * minorPerUnit) / minorPerUnit;
  }

  const monthlyRate = interestRate / 100 / MONTHS_PER_YEAR;
  const payment = (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -termMonths));
  // Half-up to the minor unit (displayed-payment convention) — unlike the half-to-even
  // interest accrual, which must mirror the backend.
  return Math.round(payment * minorPerUnit) / minorPerUnit;
}

export interface PayoffPoint {
  /** Months from today (0 = today). */
  month: number;
  date: Date;
  /** Outstanding balance at month end, decimal in the loan's currency. */
  balance: number;
}

export interface PayoffScenario {
  /** False when the payment can't cover monthly interest or the loan outlasts the horizon. */
  paysOff: boolean;
  monthsRemaining: number | null;
  payoffDate: Date | null;
  /** Total interest paid between now and payoff, decimal. Null when it never pays off. */
  totalInterest: number | null;
  /** Month-by-month balance series for the chart, starting at month 0 (today). */
  points: PayoffPoint[];
}

/** Closed-form months-to-payoff: n = ⌈log(P / (P − B·r)) / log(1 + r)⌉ — identical to the backend formula. */
function computeMonthsRemaining({
  balanceMinor,
  paymentMinor,
  interestRate,
}: {
  balanceMinor: number;
  paymentMinor: number;
  interestRate: number;
}): number {
  if (interestRate === 0) {
    return Math.ceil(balanceMinor / paymentMinor);
  }
  const monthlyRate = interestRate / 100 / MONTHS_PER_YEAR;
  const numerator = Math.log(paymentMinor / (paymentMinor - balanceMinor * monthlyRate));
  const denominator = Math.log(1 + monthlyRate);
  return Math.ceil(numerator / denominator);
}

/**
 * Project a fixed-payment scenario into a month-by-month payoff series.
 * Decimals in; `today` is injected so the function stays pure.
 */
export function computePayoffScenario({
  balance,
  interestRate,
  payment,
  today,
  decimals,
}: {
  balance: number;
  interestRate: number;
  payment: number;
  today: Date;
  /** Decimals of the loan currency: the scale of the integer minor units the iteration runs in. */
  decimals: number;
}): PayoffScenario {
  const minorPerUnit = 10 ** decimals;
  const balanceMinor = Math.round(balance * minorPerUnit);
  const paymentMinor = Math.round(payment * minorPerUnit);

  const neverPaysOff: PayoffScenario = {
    paysOff: false,
    monthsRemaining: null,
    payoffDate: null,
    totalInterest: null,
    points: [{ month: 0, date: today, balance: Math.max(0, balanceMinor) / minorPerUnit }],
  };

  if (balanceMinor <= 0) {
    return {
      paysOff: true,
      monthsRemaining: 0,
      payoffDate: today,
      totalInterest: 0,
      points: [{ month: 0, date: today, balance: 0 }],
    };
  }

  if (paymentMinor <= 0) return neverPaysOff;

  const monthlyInterestMinor = roundHalfToEven((balanceMinor * interestRate) / 100 / MONTHS_PER_YEAR);
  // A payment that cannot cover the monthly interest never reduces principal.
  if (paymentMinor <= monthlyInterestMinor) return neverPaysOff;

  const monthsRemaining = computeMonthsRemaining({ balanceMinor, paymentMinor, interestRate });
  if (!Number.isFinite(monthsRemaining) || monthsRemaining <= 0 || monthsRemaining > MAX_PROJECTION_MONTHS) {
    return neverPaysOff;
  }

  // Accumulated month by month (closed-form would overstate: the final month pays
  // only the leftover balance plus its interest). Same accrual as the backend's
  // `computeLoanProjection`, so the figure matches the Projection card to the minor unit.
  let totalInterestMinor = 0;

  const points: PayoffPoint[] = [{ month: 0, date: today, balance: balanceMinor / minorPerUnit }];
  let runningMinor = balanceMinor;
  for (let month = 1; month <= monthsRemaining; month += 1) {
    const interestMinor = roundHalfToEven((Math.max(0, runningMinor) * interestRate) / 100 / MONTHS_PER_YEAR);
    totalInterestMinor += interestMinor;
    // The last payment clears whatever is left instead of a full planned payment.
    runningMinor = Math.max(0, runningMinor + interestMinor - paymentMinor);
    // Force the final point to zero so the curve lands exactly on the payoff
    // marker; the sub-minor-unit rounding remainder is absorbed into the last payment.
    const displayMinor = month === monthsRemaining ? 0 : runningMinor;
    points.push({ month, date: addMonths(today, month), balance: displayMinor / minorPerUnit });
  }

  return {
    paysOff: true,
    monthsRemaining,
    payoffDate: addMonths(today, monthsRemaining),
    totalInterest: totalInterestMinor / minorPerUnit,
    points,
  };
}

/** Below this absolute interest delta (decimal currency units), two scenarios read as "the same" interest. */
export const SAME_INTEREST_EPSILON = 0.005;

interface PayoffComparison {
  /** scenario.totalInterest − baseline.totalInterest (decimal). Negative = scenario saves interest. */
  interestDelta: number;
  /** scenario.monthsRemaining − baseline.monthsRemaining. Negative = scenario pays off sooner. */
  monthsDelta: number;
  sameInterest: boolean;
  sameTime: boolean;
  savesInterest: boolean;
  costsInterest: boolean;
  faster: boolean;
  slower: boolean;
}

/**
 * Compare a payoff scenario against the planned-payment baseline. Caller
 * ensures both pay off; missing figures fall back to 0.
 */
export function comparePayoffScenarios({
  scenario,
  baseline,
}: {
  scenario: PayoffScenario;
  baseline: PayoffScenario;
}): PayoffComparison {
  const interestDelta = (scenario.totalInterest ?? 0) - (baseline.totalInterest ?? 0);
  const monthsDelta = (scenario.monthsRemaining ?? 0) - (baseline.monthsRemaining ?? 0);
  const sameInterest = Math.abs(interestDelta) < SAME_INTEREST_EPSILON;
  const sameTime = monthsDelta === 0;
  return {
    interestDelta,
    monthsDelta,
    sameInterest,
    sameTime,
    savesInterest: !sameInterest && interestDelta < 0,
    costsInterest: !sameInterest && interestDelta > 0,
    faster: !sameTime && monthsDelta < 0,
    slower: !sameTime && monthsDelta > 0,
  };
}
