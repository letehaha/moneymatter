import { SUPPORTED_LOAN_TYPES } from '@bt/shared/types';
import { dateString, decimalMoney, isoCurrencyCode, recordId } from '@common/lib/zod/custom-types';
import { addDays, format } from 'date-fns';
import { z } from 'zod';

/**
 * User-authored `note` entry for the append-only `LoanDetails.events` timeline.
 * The auto-stamped variants (rate_change, term_change, planned_payment_change,
 * paid_off) are never accepted from API input.
 */
export const loanNoteEventSchema = z.object({
  text: z.string().trim().min(1).max(2000),
});

const optionalNullableInt = ({ min, max }: { min: number; max?: number }) => {
  let schema = z.number().int().min(min);
  if (max !== undefined) schema = schema.max(max);
  return schema.nullable().optional();
};

const nonNegativeDecimalMoney = ({ field }: { field: string }) =>
  decimalMoney().refine((m) => !m.isNegative(), { message: `${field} must be >= 0` });

/**
 * Calendar-valid YYYY-MM-DD — `dateString()` only regex-checks the shape, so
 * 2024-02-30 would pass and 500 at the Postgres DATEONLY column. Round-trips
 * through `Date.UTC`; `Date.parse` is insufficient (V8 rolls day-overflow
 * dates over: 2024-02-30 parses as March 1).
 */
const calendarDateString = () =>
  dateString().refine(
    (value) => {
      const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
    },
    { message: 'Invalid calendar date' },
  );

/**
 * Calendar-valid YYYY-MM-DD that also rejects dates in the future. Ceiling is
 * server "tomorrow" rather than "today" so a client ahead of the server's
 * timezone isn't rejected for its own valid local date — any local calendar
 * date is at most one day ahead of UTC. Lexicographic compare is sound for
 * YYYY-MM-DD strings.
 */
const notFutureCalendarDate = ({ message }: { message: string }) =>
  calendarDateString().refine((value) => value <= format(addDays(new Date(), 1), 'yyyy-MM-dd'), { message });

/**
 * Spans both the underlying Account and the LoanDetails sidecar.
 * `initialBalance` is the outstanding amount as a positive decimal — the
 * service negates it into the negative-liability convention on
 * Accounts.currentBalance.
 */
export const createLoanBodySchema = z.object({
  name: z.string().min(1).max(200).trim(),
  currencyCode: isoCurrencyCode(),
  initialBalance: nonNegativeDecimalMoney({ field: 'initialBalance' }),

  // Only the loan types the form picker exposes are accepted; HELOC-style types
  // need multi-disbursement support before the balance machinery can back them.
  loanType: z.enum(SUPPORTED_LOAN_TYPES),
  originalPrincipal: decimalMoney().refine((m) => m.isPositive(), {
    message: 'originalPrincipal must be > 0',
  }),
  interestRate: z.number().min(0).max(99.9999),
  termMonths: optionalNullableInt({ min: 1, max: 1200 }),
  // Contractual origination date — a loan can't originate in the future.
  startDate: notFutureCalendarDate({ message: 'startDate must not be in the future' }),
  minPayment: nonNegativeDecimalMoney({ field: 'minPayment' }).nullable().optional(),
  plannedPayment: nonNegativeDecimalMoney({ field: 'plannedPayment' }).nullable().optional(),
  paymentDayOfMonth: optionalNullableInt({ min: 1, max: 31 }),
  lenderName: z.string().min(1).max(200).trim().nullable().optional(),
  accountNumber: z.string().min(1).max(100).trim().nullable().optional(),
});

export type CreateLoanBody = z.infer<typeof createLoanBodySchema>;

/**
 * Patch payload — the service diffs against the persisted row and auto-appends
 * timeline events for interestRate/termMonths/plannedPayment. `currencyCode`
 * and `loanType` are intentionally absent: currency switching is unsupported
 * codebase-wide, and loanType is UI-only metadata.
 */
export const updateLoanBodySchema = z
  .object({
    name: z.string().min(1).max(200).trim().optional(),
    // Positive outstanding amount; a negative value would flip into a loan in
    // credit once the service negates it into the ledger convention.
    currentBalance: nonNegativeDecimalMoney({ field: 'currentBalance' }).optional(),
    // Balance-anchor date: "the outstanding was `currentBalance` as-of this date".
    // Meaningless without `currentBalance` (cross-field refine enforces pairing);
    // future dates are rejected because post-anchor payment legs are summed
    // against the anchor.
    currentBalanceAsOf: notFutureCalendarDate({ message: 'currentBalanceAsOf must not be in the future' }).optional(),

    interestRate: z.number().min(0).max(99.9999).optional(),
    termMonths: optionalNullableInt({ min: 1, max: 1200 }),
    // Contractual origination date — a loan can't originate in the future.
    startDate: notFutureCalendarDate({ message: 'startDate must not be in the future' }).optional(),
    minPayment: nonNegativeDecimalMoney({ field: 'minPayment' }).nullable().optional(),
    plannedPayment: nonNegativeDecimalMoney({ field: 'plannedPayment' }).nullable().optional(),
    paymentDayOfMonth: optionalNullableInt({ min: 1, max: 31 }),
    lenderName: z.string().min(1).max(200).trim().nullable().optional(),
    accountNumber: z.string().min(1).max(100).trim().nullable().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'At least one field must be provided',
  })
  .refine((data) => data.currentBalanceAsOf === undefined || data.currentBalance !== undefined, {
    message:
      'currentBalanceAsOf requires currentBalance: the anchor date re-states the outstanding amount as-of that date',
    path: ['currentBalanceAsOf'],
  });

export type UpdateLoanBody = z.infer<typeof updateLoanBodySchema>;

/**
 * Bulk-link expense transactions to a loan as payments (each becomes a
 * transfer-to-loan with an income leg on the loan account). `confirmOverpay`
 * acknowledges pushing the loan past its owed balance.
 */
export const linkLoanPaymentsBodySchema = z.object({
  transactionIds: z
    .array(recordId())
    .min(1)
    .max(500)
    .refine((ids) => ids.length === new Set(ids).size, {
      message: 'transactionIds must not contain duplicates',
    }),
  confirmOverpay: z.boolean().optional(),
});

/**
 * `transactionId` may be either leg of the payment pair — the service deletes
 * the loan-side income leg and restores the source expense.
 */
export const unlinkLoanPaymentBodySchema = z.object({
  transactionId: recordId(),
});

export const loanIdParamsSchema = z.object({ id: recordId() });
