import {
  ACCOUNT_CATEGORIES,
  ACCOUNT_STATUSES,
  API_ERROR_CODES,
  LOAN_TYPE,
  type RecordId,
  SUPPORTED_LOAN_TYPES,
  TRANSACTION_TRANSFER_NATURE,
} from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { addDays, format, subDays } from 'date-fns';

/** Runs `fn` authenticated as the user owning `cookies`, restoring the default test user afterwards. */
async function asUser<T>({ cookies, fn }: { cookies: string; fn: () => Promise<T> }): Promise<T> {
  const original = global.APP_AUTH_COOKIES;
  global.APP_AUTH_COOKIES = cookies;
  try {
    return await fn();
  } finally {
    global.APP_AUTH_COOKIES = original;
  }
}

async function createSecondUser(): Promise<string> {
  const signupRes = await helpers.makeAuthRequest({
    method: 'post',
    url: '/auth/sign-up/email',
    payload: {
      email: `user2-${Date.now()}-${Math.random()}@test.local`,
      password: 'testpassword123',
      name: 'Second User',
    },
  });
  const cookies = helpers.extractCookies(signupRes);
  await asUser({
    cookies,
    fn: () =>
      helpers.makeRequest({
        method: 'post',
        url: '/user/currencies/base',
        payload: { currencyCode: global.BASE_CURRENCY.code },
      }),
  });
  return cookies;
}

/** Creates a loan through POST /loans so tests exercise the real creation path (ref-amount calc, tx wrapping). */
async function createLoanFixture(
  overrides: {
    accountName?: string;
    loanType?: LOAN_TYPE;
    plannedPaymentCents?: number | null;
    lenderName?: string | null;
  } = {},
) {
  const plannedPayment =
    overrides.plannedPaymentCents === undefined
      ? 1_200
      : overrides.plannedPaymentCents === null
        ? null
        : overrides.plannedPaymentCents / 100;

  const account = await helpers.createLoan({
    payload: helpers.buildCreateLoanPayload({
      name: overrides.accountName ?? 'Test mortgage',
      loanType: overrides.loanType ?? LOAN_TYPE.mortgage,
      plannedPayment,
      minPayment: plannedPayment,
      lenderName: overrides.lenderName ?? 'Chase',
    }),
    raw: true,
  });

  return { account };
}

// $1,000 loan at 12% APR (1%/mo) with a 3-month term: the scheduled
// payment is $340.02/mo and the full schedule costs $20.07 in interest
// (1,000¢ + 670¢ + 337¢) — small enough to hand-verify to the cent.
const createTermLoan = (overrides: Record<string, unknown> = {}) =>
  helpers.createLoan({
    payload: helpers.buildCreateLoanPayload({
      currencyCode: global.BASE_CURRENCY_CODE,
      initialBalance: 1_000,
      originalPrincipal: 1_000,
      interestRate: 12,
      termMonths: 3,
      ...overrides,
    }),
    raw: true,
  });

const payLoanFromNewAccount = async ({ loanId, amount, time }: { loanId: string; amount: number; time?: string }) => {
  const sourceAccount = await helpers.createAccount({ raw: true });
  await helpers.createTransaction({
    payload: {
      ...helpers.buildTransactionPayload({
        accountId: sourceAccount.id,
        amount,
        ...(time && { time }),
      }),
      transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
      destinationAmount: amount,
      destinationAccountId: loanId as RecordId,
    },
    raw: true,
  });
};

/** Base-currency loan owing `initialBalance`, plus a cash account to pay from. */
const setupLoanWithSource = async ({ initialBalance }: { initialBalance: number }) => {
  const loan = await helpers.createLoan({
    payload: helpers.buildCreateLoanPayload({
      currencyCode: global.BASE_CURRENCY_CODE,
      initialBalance,
      originalPrincipal: initialBalance,
    }),
    raw: true,
  });
  const sourceAccount = await helpers.createAccount({ raw: true });
  return { loan, sourceAccount };
};

const payLoan = async ({
  loanId,
  sourceAccountId,
  amount,
  time,
}: {
  loanId: string;
  sourceAccountId: RecordId;
  amount: number;
  /** ISO timestamp for backdated payments; defaults to now. */
  time?: string;
}) => {
  const [base] = await helpers.createTransaction({
    payload: {
      ...helpers.buildTransactionPayload({
        accountId: sourceAccountId,
        amount,
        ...(time && { time }),
      }),
      transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
      destinationAmount: amount,
      destinationAccountId: loanId as RecordId,
    },
    raw: true,
  });
  return base;
};

describe('Loans read API', () => {
  describe('GET /loans', () => {
    it('returns an empty array when the user has no loans', async () => {
      const list = await helpers.getLoans({ raw: true });
      expect(list).toEqual([]);
    });

    it('returns every loan owned by the user, archived ones included', async () => {
      const { account } = await createLoanFixture({
        accountName: 'Mortgage A',
      });
      await createLoanFixture({
        accountName: 'Auto loan',
        loanType: LOAN_TYPE.auto,
      });

      // The /loans page renders archived loans in a collapsed "Archived" section,
      // so the list endpoint must keep returning them (no active-only filter) with
      // the status the frontend partitions on preserved through the serializer.
      const archived = await helpers.updateAccount({
        id: account.id,
        payload: { status: ACCOUNT_STATUSES.archived },
        raw: true,
      });
      expect(archived.status).toBe(ACCOUNT_STATUSES.archived);

      const list = await helpers.getLoans({ raw: true });
      expect(list).toHaveLength(2);
      expect(list.map((row) => row.name).toSorted()).toEqual(['Auto loan', 'Mortgage A']);

      const archivedRow = list.find((loan) => loan.id === account.id);
      expect(archivedRow).toBeDefined();
      expect(archivedRow?.status).toBe(ACCOUNT_STATUSES.archived);
    });
  });

  describe('GET /loans/:id', () => {
    it('exposes the projection warning when planned payment cannot cover monthly interest', async () => {
      const { account } = await createLoanFixture({
        plannedPaymentCents: 10_000,
      });

      const loan = await helpers.getLoanById({ id: account.id, raw: true });
      expect(loan.projection.warning).toBe('payment_below_interest');
      expect(loan.projection.payoffDate).toBeNull();
      // Mirrors totalInterestRemaining's null: no payoff trajectory, no estimate.
      expect(loan.projection.estimatedInterestPaid).toBeNull();
    });

    it('clamps paidToDate to zero when the outstanding balance exceeds the original principal', async () => {
      // Outstanding above principal (negative amortization/correction) must not render as a negative "paid" amount.
      const created = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          originalPrincipal: 1_000,
          initialBalance: 5_000,
        }),
        raw: true,
      });

      const loan = await helpers.getLoanById({ id: created.id, raw: true });
      expect(loan.projection.paidToDate).toBe(0);
      expect(loan.projection.paidToDatePercent).toBe(0);
    });
  });

  describe('paymentsCount exposure', () => {
    it('is zero for a freshly created loan, on both create and read responses', async () => {
      const created = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload(),
        raw: true,
      });
      expect(created.paymentsCount).toBe(0);

      const fromGet = await helpers.getLoanById({ id: created.id, raw: true });
      expect(fromGet.paymentsCount).toBe(0);
    });

    it('counts recorded payments on the detail and list responses', async () => {
      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          initialBalance: 5_000,
          originalPrincipal: 5_000,
        }),
        raw: true,
      });
      const sourceAccount = await helpers.createAccount({ raw: true });

      await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: sourceAccount.id,
            amount: 500,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 500,
          destinationAccountId: loan.id as RecordId,
        },
        raw: true,
      });

      const fromGet = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(fromGet.paymentsCount).toBe(1);

      const list = await helpers.getLoans({ raw: true });
      expect(list.find((row) => row.id === loan.id)?.paymentsCount).toBe(1);
    });
  });

  describe('estimatedInterestPaid exposure', () => {
    it('is null for a loan created without a term — no schedule exists to estimate from', async () => {
      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({ termMonths: null }),
        raw: true,
      });

      expect(loan.projection.estimatedInterestPaid).toBeNull();
      // The forward-looking sibling still projects fine from the planned payment.
      expect(loan.projection.totalInterestRemaining).not.toBeNull();
    });

    it('reflects the scheduled share consumed after a partial payment', async () => {
      const loan = await createTermLoan();
      await payLoanFromNewAccount({ loanId: loan.id, amount: 500 });

      const reloaded = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloaded.currentBalance).toBe(-500);
      // Remaining $500 at the $1,200 planned payment clears in one month
      // costing $5.00 interest; estimate = 20.07 − 5.00.
      expect(reloaded.projection.totalInterestRemaining).toBe(5);
      expect(reloaded.projection.estimatedInterestPaid).toBe(15.07);
    });

    it('caps the paid-off estimate at the full lifetime figure when the loan was open longer than its term, on both detail and list', async () => {
      // Default startDate is years in the past, so the open duration far
      // exceeds the 3-month term — the accrual caps at the term and yields the
      // full-schedule $20.07, with no special-casing of "ran to term".
      const loan = await createTermLoan();
      await payLoanFromNewAccount({ loanId: loan.id, amount: 1_000 });

      const reloaded = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloaded.projection.isPaidOff).toBe(true);
      expect(reloaded.projection.totalInterestRemaining).toBe(0);
      expect(reloaded.projection.estimatedInterestPaid).toBe(20.07);

      const list = await helpers.getLoans({ raw: true });
      expect(list.find((row) => row.id === loan.id)?.projection.estimatedInterestPaid).toBe(20.07);
    });

    it('reports only the elapsed months of schedule interest when the loan is paid off early', async () => {
      // Originated ~20 days ago and settled by a payment today: less than one
      // calendar month open, and a partial month counts as a full one — the
      // estimate is exactly the first scheduled month's interest ($10.00),
      // strictly below the $20.07 full-schedule figure.
      const startDate = format(subDays(new Date(), 20), 'yyyy-MM-dd');
      const loan = await createTermLoan({ startDate });
      await payLoanFromNewAccount({ loanId: loan.id, amount: 1_000 });

      const reloaded = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloaded.projection.isPaidOff).toBe(true);
      expect(reloaded.projection.estimatedInterestPaid).toBe(10);
    });

    it('derives the open duration from the settling payment date, not the wall clock', async () => {
      // The loan originated ~100 days ago but the (backdated) settling payment
      // landed ~45 days after origination — one full month plus a partial one.
      // The estimate must accrue 2 scheduled months ($10.00 + $6.70), not the
      // ~3+ wall-clock months that have elapsed since origination.
      const start = subDays(new Date(), 100);
      const startDate = format(start, 'yyyy-MM-dd');
      const loan = await createTermLoan({ startDate });

      // Re-anchor the outstanding balance on the origination date so the
      // backdated payment counts as post-anchor and actually settles the loan.
      await helpers.updateLoan({
        id: loan.id,
        payload: { currentBalance: 1_000, currentBalanceAsOf: startDate },
        raw: true,
      });
      await payLoanFromNewAccount({
        loanId: loan.id,
        amount: 1_000,
        time: addDays(start, 45).toISOString(),
      });

      const reloaded = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloaded.projection.isPaidOff).toBe(true);
      expect(reloaded.projection.estimatedInterestPaid).toBe(16.7);
    });

    it('reports zero interest for a loan created with a zero outstanding balance', async () => {
      // Already settled at creation: no payment ever zeroes the balance, so no
      // paid_off event exists — the balance-anchor date (creation day) serves
      // as the settle date, and zero months open accrues zero interest.
      const loan = await createTermLoan({
        initialBalance: 0,
        startDate: format(new Date(), 'yyyy-MM-dd'),
      });

      expect(loan.projection.isPaidOff).toBe(true);
      expect(loan.projection.estimatedInterestPaid).toBe(0);

      const reloaded = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloaded.projection.isPaidOff).toBe(true);
      expect(reloaded.projection.estimatedInterestPaid).toBe(0);
    });
  });

  describe('POST /loans', () => {
    it('creates an Account + LoanDetails atomically and serializes the same shape on create, detail and list', async () => {
      const result = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload(),
        raw: false,
      });

      expect(result.statusCode).toBe(201);
      const loan = result.body.response as unknown as Awaited<ReturnType<typeof helpers.createLoan<true>>>;
      expect(loan.id).toEqual(expect.any(String));
      expect(loan.accountCategory).toBe(ACCOUNT_CATEGORIES.loan);
      // Loan balances persist negative for net-worth aggregation; the API exposes the raw signed value.
      expect(loan.currentBalance).toBe(-200_000);
      expect(loan.loanDetails.loanType).toBe(LOAN_TYPE.mortgage);
      expect(loan.loanDetails.originalPrincipal).toBe(200_000);
      expect(loan.loanDetails.interestRate).toBe(6);
      expect(loan.loanDetails.plannedPayment).toBe(1_200);
      expect(loan.loanDetails.events).toEqual([]);
      expect(loan.projection.isPaidOff).toBe(false);
      expect(loan.projection.monthsRemaining).toBeGreaterThan(0);

      const fromGet = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(fromGet.id).toBe(loan.id);
      expect(fromGet.loanDetails.lenderName).toBe('Chase');
      expect(fromGet.projection).toBeDefined();
      expect(fromGet.projection.monthlyInterest).toBeGreaterThan(0);

      const list = await helpers.getLoans({ raw: true });
      const row = list[0];
      if (!row) throw new Error('Expected one loan in the list');

      expect(row.id).toBe(loan.id);
      expect(row.accountCategory).toBe(ACCOUNT_CATEGORIES.loan);
      expect(row.currentBalance).toBe(-200_000);

      expect(row.loanDetails.loanType).toBe(LOAN_TYPE.mortgage);
      expect(row.loanDetails.originalPrincipal).toBe(200_000);
      expect(row.loanDetails.interestRate).toBe(6);
      expect(row.loanDetails.plannedPayment).toBe(1_200);
      expect(row.loanDetails.lenderName).toBe('Chase');
      expect(row.loanDetails.events).toEqual([]);

      expect(row.projection.isPaidOff).toBe(false);
      expect(row.projection.warning).toBeNull();
      expect(row.projection.monthsRemaining).toBe(360);
      expect(row.projection.paidToDate).toBe(0);
      // Near-zero on an untouched loan: the only drift is the gap between the
      // $1,200 planned payment and the ~$1,199.10 scheduled payment.
      expect(row.projection.estimatedInterestPaid).toBeGreaterThanOrEqual(0);
      expect(row.projection.estimatedInterestPaid).toBeLessThan(1_000);
    });

    it('does not mark a loan paid off when outstanding is below principal and the start date is years in the past', async () => {
      // startDate is informational only: the balance anchor is always today, and
      // paid-off is derived solely from the outstanding balance, not elapsed term.
      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          startDate: '2022-01-10',
          originalPrincipal: 106_000,
          initialBalance: 20_000,
        }),
        raw: true,
      });

      expect(loan.currentBalance).toBe(-20_000);
      expect(loan.projection.isPaidOff).toBe(false);
      expect(loan.projection.paidToDate).toBe(86_000);

      const fromGet = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(fromGet.currentBalance).toBe(-20_000);
      expect(fromGet.projection.isPaidOff).toBe(false);
    });

    it('surfaces the no_planned_payment warning through the API when created without plannedPayment', async () => {
      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          plannedPayment: null,
          minPayment: null,
        }),
        raw: true,
      });

      expect(loan.loanDetails.plannedPayment).toBeNull();
      expect(loan.projection.warning).toBe('no_planned_payment');
      expect(loan.projection.payoffDate).toBeNull();
      expect(loan.projection.monthsRemaining).toBeNull();
      expect(loan.projection.monthlyInterest).toBeGreaterThan(0);
      expect(loan.projection.estimatedInterestPaid).toBeNull();
    });

    it('rejects invalid create payloads with 422', async () => {
      // Only SUPPORTED_LOAN_TYPES flow through the form; the remaining LOAN_TYPE members
      // (e.g. HELOC) need multi-disbursement handling first, so creation is gated to the
      // supported subset rather than the full enum.
      const badPayloads: [label: string, overrides: Record<string, unknown>][] = [
        ['payload missing required fields', { originalPrincipal: undefined }],
        ['negative interestRate', { interestRate: -1 }],
        ['interestRate >= 100', { interestRate: 100 }],
        ['non-positive originalPrincipal', { originalPrincipal: 0 }],
        ['negative initialBalance', { initialBalance: -1 }],
        ['negative minPayment', { minPayment: -1 }],
        ['negative plannedPayment', { plannedPayment: -1 }],
        ['paymentDayOfMonth outside 1-31', { paymentDayOfMonth: 32 }],
        ['calendar-invalid startDate 2024-02-30', { startDate: '2024-02-30' }],
        ['calendar-invalid startDate 2024-13-45', { startDate: '2024-13-45' }],
        ['startDate in the future', { startDate: format(addDays(new Date(), 2), 'yyyy-MM-dd') }],
        ['a loanType the UI does not support yet', { loanType: LOAN_TYPE.heloc }],
      ];

      for (const [label, overrides] of badPayloads) {
        const result = await helpers.createLoan({
          payload: helpers.buildCreateLoanPayload(overrides),
          raw: false,
        });
        expect([label, result.statusCode]).toEqual([label, 422]);
      }
    }, 30_000);

    it('accepts a startDate of today (boundary)', async () => {
      const result = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          startDate: format(new Date(), 'yyyy-MM-dd'),
        }),
        raw: false,
      });
      expect(result.statusCode).toBe(201);
    });

    it.each(SUPPORTED_LOAN_TYPES)('accepts the supported loanType %s', async (loanType) => {
      const result = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({ loanType }),
        raw: false,
      });
      expect(result.statusCode).toBe(201);
      const loan = result.body.response as unknown as Awaited<ReturnType<typeof helpers.createLoan<true>>>;
      expect(loan.loanDetails.loanType).toBe(loanType);
    });
  });

  describe('PATCH /loans/:id', () => {
    it('appends rate_change, term_change and planned_payment_change events as those fields change', async () => {
      const created = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload(),
        raw: true,
      });

      const afterRate = await helpers.updateLoan({
        id: created.id,
        payload: { interestRate: 7.25 },
        raw: true,
      });

      expect(afterRate.loanDetails.interestRate).toBe(7.25);
      expect(afterRate.loanDetails.events).toHaveLength(1);
      const rateEvent = afterRate.loanDetails.events[0];
      expect(rateEvent?.type).toBe('rate_change');
      if (rateEvent?.type === 'rate_change') {
        expect(rateEvent.from).toBe(6);
        expect(rateEvent.to).toBe(7.25);
      }

      const afterTerm = await helpers.updateLoan({
        id: created.id,
        payload: { termMonths: 180 },
        raw: true,
      });

      expect(afterTerm.loanDetails.termMonths).toBe(180);
      const termEvent = afterTerm.loanDetails.events.at(-1);
      expect(termEvent?.type).toBe('term_change');
      if (termEvent?.type === 'term_change') {
        expect(termEvent.from).toBe(360);
        expect(termEvent.to).toBe(180);
      }

      const afterPlanned = await helpers.updateLoan({
        id: created.id,
        payload: { plannedPayment: 1500 },
        raw: true,
      });

      expect(afterPlanned.loanDetails.plannedPayment).toBe(1500);
      const plannedEvent = afterPlanned.loanDetails.events.at(-1);
      expect(plannedEvent?.type).toBe('planned_payment_change');
      if (plannedEvent?.type === 'planned_payment_change') {
        expect(plannedEvent.from).toBe(1_200);
        expect(plannedEvent.to).toBe(1_500);
      }
    });

    it('records term_change and planned_payment_change with `to: null` when those fields are cleared', async () => {
      const created = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload(),
        raw: true,
      });

      const afterTerm = await helpers.updateLoan({
        id: created.id,
        payload: { termMonths: null },
        raw: true,
      });

      expect(afterTerm.loanDetails.termMonths).toBeNull();
      const termEvent = afterTerm.loanDetails.events.at(-1);
      expect(termEvent?.type).toBe('term_change');
      if (termEvent?.type === 'term_change') {
        expect(termEvent.from).toBe(360);
        expect(termEvent.to).toBeNull();
      }

      const afterPlanned = await helpers.updateLoan({
        id: created.id,
        payload: { plannedPayment: null },
        raw: true,
      });

      // Clearing drops both the loan-currency amount and its ref (base-currency) mirror.
      expect(afterPlanned.loanDetails.plannedPayment).toBeNull();
      expect(afterPlanned.loanDetails.refPlannedPayment).toBeNull();

      const plannedEvent = afterPlanned.loanDetails.events.at(-1);
      expect(plannedEvent?.type).toBe('planned_payment_change');
      if (plannedEvent?.type === 'planned_payment_change') {
        expect(plannedEvent.from).toBe(1_200);
        // A cleared payment serializes as `to: null` — distinct from a $0 payment.
        expect(plannedEvent.to).toBeNull();
      }

      const fromGet = await helpers.getLoanById({ id: created.id, raw: true });
      expect(fromGet.loanDetails.plannedPayment).toBeNull();
      expect(fromGet.loanDetails.refPlannedPayment).toBeNull();
    });

    it('treats a plannedPayment of 0 as "set to zero", not a clear', async () => {
      const created = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload(),
        raw: true,
      });

      const updated = await helpers.updateLoan({
        id: created.id,
        payload: { plannedPayment: 0 },
        raw: true,
      });

      // Zero is a concrete amount: the value persists as 0 (not null) and its ref mirror too.
      expect(updated.loanDetails.plannedPayment).toBe(0);
      expect(updated.loanDetails.refPlannedPayment).toBe(0);

      const event = updated.loanDetails.events.at(-1);
      expect(event?.type).toBe('planned_payment_change');
      if (event?.type === 'planned_payment_change') {
        expect(event.from).toBe(1_200);
        // Serializes as 0, distinguishing "set to zero" from the null clear above.
        expect(event.to).toBe(0);
      }

      const fromGet = await helpers.getLoanById({ id: created.id, raw: true });
      expect(fromGet.loanDetails.plannedPayment).toBe(0);
    });

    it('appends no event for same-value, echoed or non-timeline-worthy patches', async () => {
      const created = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload(),
        raw: true,
      });

      const sameRate = await helpers.updateLoan({
        id: created.id,
        payload: { interestRate: 6 },
        raw: true,
      });
      expect(sameRate.loanDetails.interestRate).toBe(6);
      expect(sameRate.loanDetails.events).toEqual([]);

      const echoedBalance = await helpers.updateLoan({
        id: created.id,
        payload: { currentBalance: 200_000 },
        raw: true,
      });
      expect(echoedBalance.currentBalance).toBe(-200_000);
      expect(echoedBalance.loanDetails.events).toEqual([]);

      const lenderPatch = await helpers.updateLoan({
        id: created.id,
        payload: { lenderName: 'Wells Fargo', paymentDayOfMonth: 20 },
        raw: true,
      });
      expect(lenderPatch.loanDetails.lenderName).toBe('Wells Fargo');
      expect(lenderPatch.loanDetails.paymentDayOfMonth).toBe(20);
      expect(lenderPatch.loanDetails.events).toEqual([]);

      const renamed = await helpers.updateLoan({
        id: created.id,
        payload: { name: 'Renamed mortgage' },
        raw: true,
      });
      expect(renamed.name).toBe('Renamed mortgage');
      expect(renamed.loanDetails.events).toEqual([]);
    });

    it('rejects invalid patch payloads with 422 and leaves the loan untouched', async () => {
      const created = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload(),
        raw: true,
      });

      // The anchor date is a statement "the outstanding was X as-of Y" — a date
      // with no amount has nothing to anchor, so it must be a clean 400-class
      // rejection rather than a 200 that silently drops the payload.
      const badPayloads: [label: string, payload: Record<string, unknown>][] = [
        ['negative currentBalance', { currentBalance: -50 }],
        ['negative minPayment', { minPayment: -1 }],
        ['negative plannedPayment', { plannedPayment: -1 }],
        ['empty patch body', {}],
        ['calendar-invalid startDate', { startDate: '2024-02-30' }],
        ['future startDate', { startDate: format(addDays(new Date(), 2), 'yyyy-MM-dd') }],
        ['calendar-invalid currentBalanceAsOf', { currentBalance: 150_000, currentBalanceAsOf: '2024-02-30' }],
        [
          'currentBalanceAsOf without currentBalance',
          { currentBalanceAsOf: format(subDays(new Date(), 5), 'yyyy-MM-dd') },
        ],
      ];

      for (const [label, payload] of badPayloads) {
        const result = await helpers.updateLoan({
          id: created.id,
          payload,
          raw: false,
        });
        expect([label, result.statusCode]).toEqual([label, 422]);
      }

      const reloaded = await helpers.getLoanById({ id: created.id, raw: true });
      expect(reloaded.currentBalance).toBe(-200_000);
      expect(reloaded.loanDetails.events).toEqual([]);
    }, 30_000);

    it('re-anchors when the same balance is asserted as-of an earlier date, re-counting later payments', async () => {
      const created = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          currencyCode: global.BASE_CURRENCY_CODE,
          initialBalance: 10_000,
          originalPrincipal: 10_000,
        }),
        raw: true,
      });
      const sourceAccount = await helpers.createAccount({ raw: true });

      // Payment dated today (on the creation anchor) — outstanding drops to 8000.
      await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: sourceAccount.id,
            amount: 2_000,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 2_000,
          destinationAccountId: created.id as RecordId,
        },
        raw: true,
      });
      expect((await helpers.getLoanById({ id: created.id, raw: true })).currentBalance).toBe(-8_000);

      // Assert the SAME 8000 outstanding, but as-of yesterday. The amount echoes
      // the current balance, yet the request must not be dropped: the moved
      // anchor makes today's 2000 payment post-anchor again, so it is re-applied
      // on top of the asserted 8000.
      const updated = await helpers.updateLoan({
        id: created.id,
        payload: {
          currentBalance: 8_000,
          currentBalanceAsOf: format(subDays(new Date(), 1), 'yyyy-MM-dd'),
        },
        raw: true,
      });

      expect(updated.currentBalance).toBe(-6_000);
      const event = updated.loanDetails.events.at(-1);
      expect(event?.type).toBe('balance_correction');
      if (event?.type === 'balance_correction') {
        expect(event.from).toBe(8_000);
        expect(event.to).toBe(8_000);
      }
    });

    it('ignores attempts to change currencyCode on a loan with payments', async () => {
      // Currency is fixed at loan creation — changing it on an Account with existing
      // transactions would re-interpret every prior amount under the new currency.
      // Both update schemas omit currencyCode, so unknown-key stripping silently drops it.
      const created = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({ currencyCode: 'USD' }),
        raw: true,
      });
      const sourceAccount = await helpers.createAccount({ raw: true });
      await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: sourceAccount.id,
            amount: 250,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 250,
          destinationAccountId: created.id as RecordId,
        },
        raw: true,
      });

      const result = await helpers.updateLoan({
        id: created.id,
        payload: {
          name: 'Renamed loan',
          currencyCode: 'EUR',
        } as unknown as Record<string, unknown>,
        raw: true,
      });

      expect(result.currencyCode).toBe('USD');
      expect(result.name).toBe('Renamed loan');
    });
  });

  describe('generic PATCH /accounts/:id is restricted on loan accounts', () => {
    // A loan IS an Account (accountCategory='loan', type='system') with a
    // LoanDetails sidecar. The generic account-update endpoint must not be a back
    // door around the dedicated loan path for balance or accountCategory changes.

    it('rejects currentBalance and accountCategory changes through the generic endpoint, but not the dedicated one', async () => {
      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload(),
        raw: true,
      });

      // Positive also covers "loan pushed into credit", which the dedicated path
      // forbids by clamping to a non-negative outstanding balance.
      const result = await helpers.updateAccount({
        id: loan.id,
        payload: { currentBalance: 5_000 },
        raw: false,
      });

      expect(result.statusCode).toBe(422);
      expect((result.body.response as unknown as { code: string }).code).toBe(API_ERROR_CODES.validationError);

      const reloaded = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloaded.currentBalance).toBe(-200_000);

      const categoryResult = await helpers.updateAccount({
        id: loan.id,
        payload: { accountCategory: ACCOUNT_CATEGORIES.general },
        raw: false,
      });

      expect(categoryResult.statusCode).toBe(422);
      expect((categoryResult.body.response as unknown as { code: string }).code).toBe(API_ERROR_CODES.validationError);

      const afterCategory = await helpers.getLoanById({
        id: loan.id,
        raw: true,
      });
      expect(afterCategory.accountCategory).toBe(ACCOUNT_CATEGORIES.loan);

      const updated = await helpers.updateLoan({
        id: loan.id,
        payload: { currentBalance: 150_000 },
        raw: true,
      });

      expect(updated.currentBalance).toBe(-150_000);
      const event = updated.loanDetails.events.at(-1);
      expect(event?.type).toBe('balance_correction');
      if (event?.type === 'balance_correction') {
        expect(event.from).toBe(200_000);
        expect(event.to).toBe(150_000);
      }
    });
  });

  describe('DELETE /loans/:id', () => {
    it('removes the loan and its underlying Account row', async () => {
      const created = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload(),
        raw: true,
      });

      const deleteResult = await helpers.deleteLoan({
        id: created.id,
        raw: false,
      });
      expect(deleteResult.statusCode).toBe(204);

      const followUp = await helpers.getLoanById({
        id: created.id,
        raw: false,
      });
      expect(followUp.statusCode).toBe(404);

      const list = await helpers.getLoans({ raw: true });
      expect(list.find((l) => l.id === created.id)).toBeUndefined();
    });

    it('rejects deleting a loan that has recorded payments', async () => {
      // Deleting a loan with payments would silently throw away the expense legs
      // and principal-paid history, so payments must be cleared first.
      const created = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload(),
        raw: true,
      });
      const sourceAccount = await helpers.createAccount({ raw: true });

      await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: sourceAccount.id,
            amount: 500,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 500,
          destinationAccountId: created.id as RecordId,
        },
        raw: true,
      });

      const response = await helpers.deleteLoan({ id: created.id, raw: false });
      expect(response.statusCode).toBe(422);
      const errorBody = (response as helpers.CustomResponse<unknown>).body.response as {
        code: string;
        message: string;
      };
      expect(errorBody.code).toBe(API_ERROR_CODES.validationError);
      expect(errorBody.message).toMatch(/payment/i);

      const stillThere = await helpers.getLoanById({
        id: created.id,
        raw: false,
      });
      expect(stillThere.statusCode).toBe(200);
    });

    it('deletes a loan whose history is a note and a balance correction but no payments', async () => {
      // Timeline events are self-contained metadata that disappears with the loan,
      // so only real payment legs block deletion.
      const created = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload(),
        raw: true,
      });

      await helpers.appendLoanNote({
        id: created.id,
        text: 'Refinance window opens Q4',
        raw: true,
      });

      const corrected = await helpers.updateLoan({
        id: created.id,
        payload: { currentBalance: 150_000 },
        raw: true,
      });
      expect(corrected.loanDetails.events.at(-1)?.type).toBe('balance_correction');

      const response = await helpers.deleteLoan({ id: created.id, raw: false });
      expect(response.statusCode).toBe(204);

      const followUp = await helpers.getLoanById({
        id: created.id,
        raw: false,
      });
      expect(followUp.statusCode).toBe(404);
    });
  });

  describe('POST /loans/:id/events', () => {
    it('appends a note event to the loan timeline', async () => {
      const created = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload(),
        raw: true,
      });

      const updated = await helpers.appendLoanNote({
        id: created.id,
        text: 'Refinance window opens 2026',
        raw: true,
      });

      expect(updated.loanDetails.events).toHaveLength(1);
      const event = updated.loanDetails.events[0];
      expect(event?.type).toBe('note');
      if (event?.type === 'note') {
        expect(event.text).toBe('Refinance window opens 2026');
      }
    });

    it('rejects an empty note', async () => {
      const created = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload(),
        raw: true,
      });

      const result = await helpers.appendLoanNote({
        id: created.id,
        text: '   ',
        raw: false,
      });
      expect(result.statusCode).toBe(422);
    });
  });

  it('responds 404 on every id-addressed loan endpoint for an unknown id', async () => {
    const unknownId = generateRandomRecordId();

    const getResult = await helpers.getLoanById({ id: unknownId, raw: false });
    expect(getResult.statusCode).toBe(404);
    expect((getResult.body.response as unknown as { code: string }).code).toBe(API_ERROR_CODES.notFound);

    const patchResult = await helpers.updateLoan({
      id: unknownId,
      payload: { interestRate: 5 },
      raw: false,
    });
    expect(patchResult.statusCode).toBe(404);

    const deleteResult = await helpers.deleteLoan({
      id: unknownId,
      raw: false,
    });
    expect(deleteResult.statusCode).toBe(404);

    const noteResult = await helpers.appendLoanNote({
      id: unknownId,
      text: 'note',
      raw: false,
    });
    expect(noteResult.statusCode).toBe(404);
  });

  describe('paid_off timeline event', () => {
    it('stamps a single paid_off event on payoff, drops it on reopen, and stamps one again when the loan re-zeroes', async () => {
      const { loan, sourceAccount } = await setupLoanWithSource({
        initialBalance: 1_000,
      });

      const payment = await payLoan({
        loanId: loan.id,
        sourceAccountId: sourceAccount.id as RecordId,
        amount: 1_000,
      });

      const paidOff = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(paidOff.currentBalance).toBe(0);
      expect(paidOff.projection.isPaidOff).toBe(true);
      const paidOffEvents = paidOff.loanDetails.events.filter((e) => e.type === 'paid_off');
      expect(paidOffEvents).toHaveLength(1);
      if (paidOffEvents[0]?.type === 'paid_off') {
        expect(typeof paidOffEvents[0].at).toBe('string');
      }

      // Deleting the payoff payment reopens the loan — the balance goes negative
      // again and the timeline must no longer claim the loan is paid off.
      await helpers.deleteTransaction({ id: payment.id });

      const reopened = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reopened.currentBalance).toBe(-1_000);
      expect(reopened.loanDetails.events.filter((e) => e.type === 'paid_off')).toHaveLength(0);

      // Paying it off again is a fresh negative→zero transition — exactly one event.
      await payLoan({
        loanId: loan.id,
        sourceAccountId: sourceAccount.id as RecordId,
        amount: 1_000,
      });

      const repaid = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(repaid.currentBalance).toBe(0);
      expect(repaid.loanDetails.events.filter((e) => e.type === 'paid_off')).toHaveLength(1);
    });

    it('drops the paid_off event when shrinking the settling payment reopens the loan', async () => {
      const { loan, sourceAccount } = await setupLoanWithSource({
        initialBalance: 1_000,
      });

      const payment = await payLoan({
        loanId: loan.id,
        sourceAccountId: sourceAccount.id as RecordId,
        amount: 1_000,
      });
      const paidOff = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(paidOff.loanDetails.events.filter((e) => e.type === 'paid_off')).toHaveLength(1);

      // Shrinking the payoff payment reopens the loan: −1,000 + 400 = −600 owed.
      await helpers.updateTransaction({
        id: payment.id,
        payload: { destinationAmount: 400 },
        raw: true,
      });

      const reopened = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reopened.currentBalance).toBe(-600);
      expect(reopened.loanDetails.events.filter((e) => e.type === 'paid_off')).toHaveLength(0);
    });

    it('stamps paid_off with the date of the payment that actually settles when several payments exist', async () => {
      const { loan, sourceAccount } = await setupLoanWithSource({
        initialBalance: 1_000,
      });

      const anchorDate = format(subDays(new Date(), 30), 'yyyy-MM-dd');
      await helpers.updateLoan({
        id: loan.id,
        payload: { currentBalance: 1_000, currentBalanceAsOf: anchorDate },
        raw: true,
      });

      // First payment leaves −600 owed; the second (later-dated) one settles.
      const firstTime = subDays(new Date(), 20);
      const secondTime = subDays(new Date(), 10);
      await payLoan({
        loanId: loan.id,
        sourceAccountId: sourceAccount.id as RecordId,
        amount: 400,
        time: firstTime.toISOString(),
      });
      await payLoan({
        loanId: loan.id,
        sourceAccountId: sourceAccount.id as RecordId,
        amount: 600,
        time: secondTime.toISOString(),
      });

      const reloaded = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloaded.currentBalance).toBe(0);
      const paidOffEvents = reloaded.loanDetails.events.filter((e) => e.type === 'paid_off');
      expect(paidOffEvents).toHaveLength(1);
      if (paidOffEvents[0]?.type === 'paid_off') {
        expect(paidOffEvents[0].at.slice(0, 10)).toBe(secondTime.toISOString().slice(0, 10));
      }
    });

    it('appends paid_off when a manual balance correction zeroes the outstanding', async () => {
      const { loan } = await setupLoanWithSource({ initialBalance: 1_000 });

      const updated = await helpers.updateLoan({
        id: loan.id,
        payload: { currentBalance: 0 },
        raw: true,
      });

      expect(updated.currentBalance).toBe(0);
      const types = updated.loanDetails.events.map((e) => e.type);
      expect(types).toContain('balance_correction');
      expect(types.filter((t) => t === 'paid_off')).toHaveLength(1);
    });
  });

  describe('cross-user isolation', () => {
    it("responds 404 on GET/PATCH/DELETE /loans/:id and POST /loans/:id/events for another user's loan", async () => {
      const userBCookies = await createSecondUser();
      const userBLoanId = await asUser({
        cookies: userBCookies,
        fn: async () => {
          const loan = await helpers.createLoan({
            payload: helpers.buildCreateLoanPayload({
              currencyCode: global.BASE_CURRENCY_CODE,
            }),
            raw: true,
          });
          return loan.id;
        },
      });

      // All four id-addressed endpoints must behave exactly as if the loan does
      // not exist — a real foreign id and a random id are indistinguishable.
      const getResult = await helpers.getLoanById({
        id: userBLoanId,
        raw: false,
      });
      expect(getResult.statusCode).toBe(404);

      const patchResult = await helpers.updateLoan({
        id: userBLoanId,
        payload: { interestRate: 1.5 },
        raw: false,
      });
      expect(patchResult.statusCode).toBe(404);

      const deleteResult = await helpers.deleteLoan({
        id: userBLoanId,
        raw: false,
      });
      expect(deleteResult.statusCode).toBe(404);

      const noteResult = await helpers.appendLoanNote({
        id: userBLoanId,
        text: 'intrusion',
        raw: false,
      });
      expect(noteResult.statusCode).toBe(404);

      // The owner's loan is untouched by all of the rejected calls above.
      const fromOwner = await asUser({
        cookies: userBCookies,
        fn: () => helpers.getLoanById({ id: userBLoanId, raw: true }),
      });
      expect(fromOwner.id).toBe(userBLoanId);
      expect(fromOwner.loanDetails.interestRate).toBe(6);
      expect(fromOwner.loanDetails.events).toEqual([]);
    });
  });
});
