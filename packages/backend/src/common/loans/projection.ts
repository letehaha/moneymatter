import type { LoanProjection } from '@bt/shared/types';
import { minorUnitsToApiDecimal, minorUnitsToApiDecimalOrNull } from '@common/types/money';
import { roundHalfToEven } from '@common/utils/round-half-to-even';

/**
 * Pure payoff projection for a loan — `today` is injected so tests can fix the
 * clock. Math runs in integer minor units at the loan currency's `decimals` (banker's
 * rounding for monthly interest); outputs are decimals ready for `res.json()`. The ACTIVE
 * payoff trajectory must stay in lockstep with the frontend's `computePayoffScenario`
 * (pages/loans/utils/payoff-schedule.ts) so the Projection card and the payoff chart agree
 * to the minor unit; the paid-off interest estimate has no frontend
 * counterpart — paid-off surfaces read `estimatedInterestPaid` from the API.
 */
interface LoanProjectionInput {
  /** Outstanding balance in minor units, non-negative. Zero projects as `isPaidOff: true`. */
  currentBalanceMinorUnits: number;
  /** Lender-issued principal at origination, in minor units. */
  originalPrincipalMinorUnits: number;
  /** APR as percent, e.g. 3.75 for 3.75%. Must be in [0, 100). */
  interestRate: number;
  /** Planned monthly payment, in minor units. `null` when the user hasn't set one. */
  plannedPaymentMinorUnits: number | null;
  /**
   * Contractual term in months, used only to derive `estimatedInterestPaid`
   * from the original amortization schedule. Omitted/`null` means the term is
   * unknown and the estimate is `null`.
   */
  termMonths?: number | null;
  /**
   * Contractual origination date (yyyy-MM-dd). Together with `settleDate` it
   * caps the paid-off `estimatedInterestPaid` at the schedule interest for the
   * months the loan was actually open, instead of the full lifetime figure.
   */
  startDate?: string | null;
  /**
   * The moment the loan settled (ISO timestamp or yyyy-MM-dd); only consulted
   * when the balance is zero. When either `startDate` or `settleDate` is
   * missing/unparsable the open duration is unknown, and the paid-off estimate
   * falls back to the full scheduled lifetime interest.
   */
  settleDate?: string | null;
  /** Reference "now" anchoring `payoffDate`. */
  today: Date | string;
  /** Decimals of the loan currency: the scale of every minor-units figure in and out of this module. */
  decimals: number;
}

const MONTHS_PER_YEAR = 12;

/** Payoff-horizon cap in months (100 years, matching the loan-term cap). */
const MAX_PROJECTION_MONTHS = 1200;

export function computeLoanProjection(input: LoanProjectionInput): LoanProjection {
  const { currentBalanceMinorUnits, originalPrincipalMinorUnits, interestRate, decimals } = input;
  // A planned payment of 0 means "no plan", not underfunded — normalize to null
  // so it yields `no_planned_payment`, not `payment_below_interest`.
  const plannedPaymentMinorUnits = input.plannedPaymentMinorUnits === 0 ? null : input.plannedPaymentMinorUnits;
  const today = input.today instanceof Date ? input.today : new Date(input.today);

  // A balance above the original principal (negative amortization) would make
  // principal-paid negative; floor at zero so the UI reads "0 paid".
  const paidToDateMinorUnits = Math.max(0, originalPrincipalMinorUnits - currentBalanceMinorUnits);
  const paidToDate = minorUnitsToApiDecimal({ value: paidToDateMinorUnits, decimals });
  const paidToDatePercent = computePaidToDatePercent({ paidToDateMinorUnits, originalPrincipalMinorUnits });

  const isPaidOff = currentBalanceMinorUnits <= 0;

  const scheduledLifetimeInterestMinorUnits = computeScheduledInterestMinorUnits({
    originalPrincipalMinorUnits,
    interestRate,
    termMonths: input.termMonths ?? null,
  });

  if (isPaidOff) {
    // The estimate is the original schedule's interest accrued over the months
    // the loan was actually open (a partial trailing month counts as a full
    // one, and the accrual caps at the term — a loan open longer than its term
    // reports the full lifetime figure). Unknown open duration falls back to
    // the full scheduled lifetime interest.
    const openMonths = computeOpenMonths({
      startDate: input.startDate ?? null,
      settleDate: input.settleDate ?? null,
    });
    const estimatedInterestPaidMinorUnits =
      openMonths === null
        ? scheduledLifetimeInterestMinorUnits
        : computeScheduledInterestMinorUnits({
            originalPrincipalMinorUnits,
            interestRate,
            termMonths: input.termMonths ?? null,
            accrueMonths: openMonths,
          });

    return {
      payoffDate: null,
      monthsRemaining: 0,
      totalInterestRemaining: 0,
      estimatedInterestPaid: minorUnitsToApiDecimalOrNull({ value: estimatedInterestPaidMinorUnits, decimals }),
      paidToDate,
      paidToDatePercent,
      monthlyInterest: 0,
      monthlyPrincipal: null,
      isPaidOff: true,
      warning: null,
    };
  }

  const monthlyInterestMinorUnits = roundHalfToEven((currentBalanceMinorUnits * interestRate) / 100 / MONTHS_PER_YEAR);

  if (plannedPaymentMinorUnits === null) {
    return {
      payoffDate: null,
      monthsRemaining: null,
      totalInterestRemaining: null,
      // Mirrors totalInterestRemaining: with no payoff trajectory there is no
      // remaining-interest figure to subtract from the schedule.
      estimatedInterestPaid: null,
      paidToDate,
      paidToDatePercent,
      monthlyInterest: minorUnitsToApiDecimal({ value: monthlyInterestMinorUnits, decimals }),
      monthlyPrincipal: null,
      isPaidOff: false,
      warning: 'no_planned_payment',
    };
  }

  // A payment ≤ monthly interest never reduces principal (equality counts as
  // below), so `monthlyPrincipal` is null — there is nothing to display.
  const paymentBelowInterest = {
    payoffDate: null,
    monthsRemaining: null,
    totalInterestRemaining: null,
    estimatedInterestPaid: null,
    paidToDate,
    paidToDatePercent,
    monthlyInterest: minorUnitsToApiDecimal({ value: monthlyInterestMinorUnits, decimals }),
    monthlyPrincipal: null,
    isPaidOff: false,
    warning: 'payment_below_interest',
  } as const;

  if (plannedPaymentMinorUnits <= monthlyInterestMinorUnits) {
    return paymentBelowInterest;
  }

  const monthsRemaining = computeMonthsRemaining({
    currentBalanceMinorUnits,
    plannedPaymentMinorUnits,
    interestRate,
  });

  // A positive payment so small the loan outlasts the horizon reports the same
  // way an underfunded payment does.
  if (monthsRemaining > MAX_PROJECTION_MONTHS) {
    return paymentBelowInterest;
  }

  const totalInterestRemainingMinorUnits = computeTotalInterestMinorUnits({
    balanceMinorUnits: currentBalanceMinorUnits,
    paymentMinorUnits: plannedPaymentMinorUnits,
    interestRate,
    months: monthsRemaining,
  });

  return {
    payoffDate: addMonthsIso({ from: today, months: monthsRemaining }),
    monthsRemaining,
    totalInterestRemaining: minorUnitsToApiDecimal({ value: totalInterestRemainingMinorUnits, decimals }),
    // Clamped at 0: a payoff trajectory faster than the contractual schedule
    // makes remaining interest exceed the scheduled share "used up" so far.
    estimatedInterestPaid:
      scheduledLifetimeInterestMinorUnits === null
        ? null
        : minorUnitsToApiDecimal({
            value: Math.max(0, scheduledLifetimeInterestMinorUnits - totalInterestRemainingMinorUnits),
            decimals,
          }),
    paidToDate,
    paidToDatePercent,
    monthlyInterest: minorUnitsToApiDecimal({ value: monthlyInterestMinorUnits, decimals }),
    monthlyPrincipal: minorUnitsToApiDecimal({ value: plannedPaymentMinorUnits - monthlyInterestMinorUnits, decimals }),
    isPaidOff: false,
    warning: null,
  };
}

function computeMonthsRemaining({
  currentBalanceMinorUnits,
  plannedPaymentMinorUnits,
  interestRate,
}: {
  currentBalanceMinorUnits: number;
  plannedPaymentMinorUnits: number;
  interestRate: number;
}): number {
  if (interestRate === 0) {
    return Math.ceil(currentBalanceMinorUnits / plannedPaymentMinorUnits);
  }
  const monthlyRate = interestRate / 100 / MONTHS_PER_YEAR;
  const numerator = Math.log(
    plannedPaymentMinorUnits / (plannedPaymentMinorUnits - currentBalanceMinorUnits * monthlyRate),
  );
  const denominator = Math.log(1 + monthlyRate);
  return Math.ceil(numerator / denominator);
}

/**
 * Month-by-month interest accrual in integer minor units. Closed-form
 * `payment × months − balance` would overstate: the final month pays only the
 * leftover balance plus its interest. Mirrors the frontend's
 * `computePayoffScenario` accrual (same per-month banker's rounding).
 */
function computeTotalInterestMinorUnits({
  balanceMinorUnits,
  paymentMinorUnits,
  interestRate,
  months,
}: {
  balanceMinorUnits: number;
  paymentMinorUnits: number;
  interestRate: number;
  months: number;
}): number {
  const monthlyRate = interestRate / 100 / MONTHS_PER_YEAR;
  let remainingMinorUnits = balanceMinorUnits;
  let totalInterestMinorUnits = 0;
  for (let month = 1; month <= months && remainingMinorUnits > 0; month += 1) {
    const interestMinorUnits = roundHalfToEven(remainingMinorUnits * monthlyRate);
    totalInterestMinorUnits += interestMinorUnits;
    // The last payment clears whatever is left instead of a full planned payment.
    remainingMinorUnits = Math.max(0, remainingMinorUnits + interestMinorUnits - paymentMinorUnits);
  }
  return totalInterestMinorUnits;
}

/**
 * Interest a borrower pays when following the original amortization schedule:
 * `originalPrincipal` amortized over `termMonths` at `interestRate`, accrued
 * with the same month-by-month banker's rounding as
 * `computeTotalInterestMinorUnits`. `accrueMonths` limits the accrual to the first
 * N scheduled months (capped at the term; the scheduled payment is always
 * derived from the FULL term); omitted, the whole schedule accrues — the
 * lifetime figure. This is an ESTIMATE input for `estimatedInterestPaid` —
 * recorded payments carry no interest split, so the schedule is the only
 * interest model available. `null` when there is no usable schedule
 * (missing/degenerate term or principal); a zero-APR schedule costs 0.
 */
function computeScheduledInterestMinorUnits({
  originalPrincipalMinorUnits,
  interestRate,
  termMonths,
  accrueMonths,
}: {
  originalPrincipalMinorUnits: number;
  interestRate: number;
  termMonths: number | null;
  accrueMonths?: number;
}): number | null {
  if (termMonths === null || termMonths <= 0 || termMonths > MAX_PROJECTION_MONTHS) return null;
  if (originalPrincipalMinorUnits <= 0) return null;
  if (interestRate === 0) return 0;

  const monthlyRate = interestRate / 100 / MONTHS_PER_YEAR;
  // Standard amortized payment. Rounding it to a whole minor unit can leave a
  // few-minor-unit residual after the final scheduled month; that residual's
  // interest is ignored as noise.
  const scheduledPaymentMinorUnits = roundHalfToEven(
    (originalPrincipalMinorUnits * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -termMonths)),
  );

  return computeTotalInterestMinorUnits({
    balanceMinorUnits: originalPrincipalMinorUnits,
    paymentMinorUnits: scheduledPaymentMinorUnits,
    interestRate,
    months: Math.min(accrueMonths ?? termMonths, termMonths),
  });
}

/**
 * Whole calendar months (UTC) a loan stayed open, from `startDate`
 * (yyyy-MM-dd origination) to `settleDate` (ISO timestamp or yyyy-MM-dd). A
 * partial trailing month counts as a full month (ceil); settling on the start
 * date itself is 0 months, and a settle date somehow before the start clamps
 * to 0. `null` when either date is missing or unparsable — the open duration
 * is unknown.
 */
function computeOpenMonths({
  startDate,
  settleDate,
}: {
  startDate: string | null;
  settleDate: string | null;
}): number | null {
  if (!startDate || !settleDate) return null;
  // yyyy-MM-dd parses as UTC midnight, full ISO timestamps as themselves — so
  // both dates compare on the same UTC calendar.
  const start = new Date(startDate);
  const settle = new Date(settleDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(settle.getTime())) return null;

  const wholeMonths =
    (settle.getUTCFullYear() - start.getUTCFullYear()) * MONTHS_PER_YEAR + (settle.getUTCMonth() - start.getUTCMonth());
  const partialMonth = settle.getUTCDate() > start.getUTCDate() ? 1 : 0;
  return Math.max(0, wholeMonths + partialMonth);
}

function computePaidToDatePercent({
  paidToDateMinorUnits,
  originalPrincipalMinorUnits,
}: {
  paidToDateMinorUnits: number;
  originalPrincipalMinorUnits: number;
}): number {
  if (originalPrincipalMinorUnits <= 0) return 0;
  const raw = (paidToDateMinorUnits / originalPrincipalMinorUnits) * 100;
  const clamped = Math.max(0, Math.min(100, raw));
  return Math.round(clamped * 10) / 10;
}

function addMonthsIso({ from, months }: { from: Date; months: number }): string {
  // Clamp to the last day of the target month: Jan 31 + 1 month must land on
  // Feb 28/29, not Mar 2/3 (Date-constructor overflow).
  const targetMonth = from.getMonth() + months;
  const lastDayOfTargetMonth = new Date(from.getFullYear(), targetMonth + 1, 0).getDate();
  const result = new Date(from.getFullYear(), targetMonth, Math.min(from.getDate(), lastDayOfTargetMonth));
  if (!Number.isFinite(result.getTime())) {
    // Caller failed to bound `months`; fail loudly instead of serializing "NaN-NaN-NaN".
    throw new Error(`addMonthsIso produced an invalid date from ${months} months`);
  }
  const yyyy = result.getFullYear();
  const mm = String(result.getMonth() + 1).padStart(2, '0');
  const dd = String(result.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
