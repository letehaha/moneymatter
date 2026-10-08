import type { AccountApiResponse } from './accounts';
import type { RecordId } from './record-id';

/**
 * Loan sub-type on `LoanDetails.loanType` — UI grouping/badges only, no impact
 * on amortization or balance handling. VARCHAR in the DB (no-DB-enums rule).
 */
export enum LOAN_TYPE {
  mortgage = 'mortgage',
  auto = 'auto',
  student = 'student',
  personal = 'personal',
  heloc = 'heloc',
  business = 'business',
  medical = 'medical',
  other = 'other',
}

/** Subset of `LOAN_TYPE` the form picker exposes; HELOC-style types need multi-disbursement support first. */
export const SUPPORTED_LOAN_TYPES = [
  LOAN_TYPE.mortgage,
  LOAN_TYPE.auto,
  LOAN_TYPE.student,
  LOAN_TYPE.personal,
] as const;

/**
 * Append-only audit/timeline entries on `LoanDetails.events` (JSONB). `at` is
 * ISO 8601; rate values are APR percent; `null` from/to means "not set". Money
 * fields are cents at rest — the API serializer converts to decimals (see
 * `LoanEventApi`). `balance_correction` records a manual outstanding edit
 * (positive amounts) that bypasses the payment flow.
 *
 * Adding an event type: extend this union and the Zod schema. `LoanEventApi` is
 * derived from this union, so the wire shape updates automatically. Only a
 * branch that carries cents (`fromCents`/`toCents`) needs a matching case in
 * `serializeLoanEvent` — its exhaustiveness check turns a forgotten conversion
 * into a compile error; cents-free branches pass through untouched.
 */
export type LoanEvent =
  | { type: 'rate_change'; at: string; from: number; to: number }
  | { type: 'term_change'; at: string; from: number | null; to: number | null; reason?: string }
  | { type: 'planned_payment_change'; at: string; fromCents: number | null; toCents: number | null }
  | { type: 'balance_correction'; at: string; fromCents: number; toCents: number }
  | { type: 'note'; at: string; text: string }
  | { type: 'paid_off'; at: string };

export type LoanEventType = LoanEvent['type'];

/**
 * Renames the cents-denominated `fromCents`/`toCents` fields of a single event
 * branch to the decimal `from`/`to` the API emits; every other field passes
 * through unchanged. Distributes over a union of branches.
 */
type LoanEventBranchToApi<T> = T extends unknown
  ? { [K in keyof T as K extends 'fromCents' ? 'from' : K extends 'toCents' ? 'to' : K]: T[K] }
  : never;

/**
 * Wire shape of `LoanEvent`, derived mechanically: cents fields become decimal
 * `from`/`to` per the decimals-in-API convention. Never hand-edit — it tracks
 * `LoanEvent`.
 */
export type LoanEventApi = LoanEventBranchToApi<LoanEvent>;

/**
 * Why forward-looking projection metrics are unavailable: no planned payment
 * set vs. a payment mathematically too small to amortize.
 */
export type LoanProjectionWarning = 'no_planned_payment' | 'payment_below_interest';

/** Progress metrics available in every projection state. Decimals per the decimals-in-API convention. */
interface LoanProjectionProgress {
  /** Cumulative principal paid down to date (originalPrincipal − currentBalance). */
  paidToDate: number;
  /** 0..100 — paidToDate / originalPrincipal × 100. */
  paidToDatePercent: number;
  /** Interest accruing on the current balance over the next month at the current APR. */
  monthlyInterest: number;
}

/**
 * A settled loan (balance at or below zero). Forward-looking figures collapse:
 * no payoff date, zero months and interest remaining, no monthly principal.
 */
interface PaidOffLoanProjection extends LoanProjectionProgress {
  isPaidOff: true;
  warning: null;
  payoffDate: null;
  monthsRemaining: number;
  totalInterestRemaining: number;
  /**
   * Amortization-schedule ESTIMATE of interest paid so far. A paid-off loan
   * reports the scheduled interest for the months it was actually open (the
   * full lifetime figure when the open duration is unknown). Null when
   * termMonths is unset. Payments are recorded as 100% principal — no actual
   * interest split is stored — so this is derived, not measured.
   */
  estimatedInterestPaid: number | null;
  monthlyPrincipal: null;
}

/**
 * An active loan with no usable payoff trajectory: either no planned payment is
 * set, or the payment is too small to amortize. Every forward-looking metric is
 * null; `warning` says which case applies.
 */
interface StalledLoanProjection extends LoanProjectionProgress {
  isPaidOff: false;
  warning: LoanProjectionWarning;
  payoffDate: null;
  monthsRemaining: null;
  totalInterestRemaining: null;
  estimatedInterestPaid: null;
  monthlyPrincipal: null;
}

/**
 * An active loan on a real payoff trajectory: a planned payment large enough to
 * amortize within the horizon, so every forward-looking metric is populated.
 */
interface AmortizingLoanProjection extends LoanProjectionProgress {
  isPaidOff: false;
  warning: null;
  /** ISO date (YYYY-MM-DD) when the loan would be paid off at the current trajectory. */
  payoffDate: string;
  monthsRemaining: number;
  /** Total interest still to be paid between now and payoff. */
  totalInterestRemaining: number;
  /**
   * Amortization-schedule ESTIMATE of interest paid so far: scheduled lifetime
   * interest (originalPrincipal amortized over termMonths at interestRate)
   * minus totalInterestRemaining, clamped at 0. Null when termMonths is unset.
   * Payments are recorded as 100% principal — no actual interest split is
   * stored — so this is derived, not measured.
   */
  estimatedInterestPaid: number | null;
  /** plannedPayment − monthlyInterest. */
  monthlyPrincipal: number;
}

/**
 * Forward-looking payoff projection for a loan. A discriminated union over
 * `isPaidOff`/`warning` so contradictory shapes (e.g. a warning alongside a
 * populated payoff date) are unrepresentable. The wire shape is the same set of
 * fields in every branch — only their nullability differs by state.
 */
export type LoanProjection = PaidOffLoanProjection | StalledLoanProjection | AmortizingLoanProjection;

/**
 * Serialized loan-details sidecar. Money fields are decimals (cents converted
 * on the way out); `events` carry the decimal `LoanEventApi` wire shape.
 */
export interface LoanDetailsApiResponse {
  id: RecordId;
  loanType: LOAN_TYPE;
  originalPrincipal: number;
  refOriginalPrincipal: number;
  interestRate: number;
  termMonths: number | null;
  startDate: string;
  balanceAnchorDate: string;
  minPayment: number | null;
  refMinPayment: number | null;
  plannedPayment: number | null;
  refPlannedPayment: number | null;
  paymentDayOfMonth: number | null;
  lenderName: string | null;
  accountNumber: string | null;
  events: LoanEventApi[];
  createdAt: string;
  updatedAt: string;
}

/**
 * A loan response spreads the underlying Account at the top level (a loan IS an
 * Account) with `loanDetails` and `projection` nested alongside, so consumers
 * treat a loan as an Account plus extras instead of a new shape. `id` is the
 * underlying Account id; liability balances arrive negative.
 */
export type LoanApiResponse = AccountApiResponse & {
  loanDetails: LoanDetailsApiResponse;
  projection: LoanProjection;
  /** Payment-leg count; the frontend warns that deletion is blocked before the user confirms. */
  paymentsCount: number;
};

/** One point in a loan's outstanding-balance series, in the loan's native currency. */
export interface LoanBalanceHistoryPoint {
  /** yyyy-MM-dd */
  date: string;
  /**
   * Signed outstanding balance, decimal in the loan's native currency —
   * negative while debt is outstanding, 0 once settled (never positive).
   */
  amount: number;
}

/**
 * 1:1 sidecar on `Accounts` for loan-category accounts (APR, payment plan,
 * lender metadata, event log); the Account still owns the balance (stored
 * negative) and currency. Monetary values are cents (BIGINT), surfaced as
 * Money via model getters.
 */
export interface LoanDetailsModel {
  id: RecordId;
  accountId: RecordId;
  userId: number;
  /** Sub-type (mortgage, auto, student…) – drives UI grouping only. */
  loanType: LOAN_TYPE;
  /**
   * Lender-issued principal in cents, immutable after create —
   * Account.initialBalance drifts with balance corrections, so this frozen
   * field preserves the amortization reference.
   */
  originalPrincipal: number;
  /** Same value converted to the user's base currency at LoanDetails creation. */
  refOriginalPrincipal: number;
  /** APR as percent, e.g. 3.75. Range [0, 100). DECIMAL at rest; the model getter parses Postgres' string to number. */
  interestRate: number;
  termMonths: number | null;
  startDate: string;
  /**
   * Date the outstanding balance (Account.initialBalance) is asserted as-of;
   * post-anchor payments adjust it, earlier ones are baked into the snapshot.
   * Distinct from startDate (contractual origination, never moves).
   */
  balanceAnchorDate: string;
  minPayment: number | null;
  refMinPayment: number | null;
  plannedPayment: number | null;
  refPlannedPayment: number | null;
  /** Day-of-month [1, 31]. Values 29/30/31 clamp to the last day of short months at display/schedule time. */
  paymentDayOfMonth: number | null;
  lenderName: string | null;
  /** Lender's account/loan identifier as the user records it — last four, full number, or any reference they prefer. No format enforced. */
  accountNumber: string | null;
  /** Append-only audit/timeline; see LoanEvent. */
  events: LoanEvent[];
  createdAt: Date;
  updatedAt: Date;
}
