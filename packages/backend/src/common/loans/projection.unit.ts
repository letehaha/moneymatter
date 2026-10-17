import { describe, expect, it } from '@jest/globals';

import { computeLoanProjection } from './projection';

const TODAY = new Date('2026-06-09T00:00:00Z');

describe('computeLoanProjection', () => {
  describe('paid-off loan', () => {
    it('flags isPaidOff true when balance is exactly zero', () => {
      const result = computeLoanProjection({
        currentBalanceMinorUnits: 0,
        originalPrincipalMinorUnits: 32_000_000,
        interestRate: 3.75,
        plannedPaymentMinorUnits: 150_000,
        today: TODAY,
        decimals: 2,
      });

      expect(result.isPaidOff).toBe(true);
      expect(result.payoffDate).toBeNull();
      expect(result.monthsRemaining).toBe(0);
      expect(result.totalInterestRemaining).toBe(0);
      expect(result.paidToDate).toBe(320_000);
      expect(result.paidToDatePercent).toBe(100);
      expect(result.warning).toBeNull();
    });

    it('flags isPaidOff true when the balance is negative (overpaid)', () => {
      const result = computeLoanProjection({
        currentBalanceMinorUnits: -500,
        originalPrincipalMinorUnits: 32_000_000,
        interestRate: 3.75,
        plannedPaymentMinorUnits: 150_000,
        today: TODAY,
        decimals: 2,
      });

      expect(result.isPaidOff).toBe(true);
      expect(result.paidToDatePercent).toBe(100);
    });
  });

  describe('no planned payment', () => {
    it('returns a no_planned_payment warning and skips forward-looking fields', () => {
      const result = computeLoanProjection({
        currentBalanceMinorUnits: 24_510_050,
        originalPrincipalMinorUnits: 32_000_000,
        interestRate: 3.75,
        plannedPaymentMinorUnits: null,
        today: TODAY,
        decimals: 2,
      });

      expect(result.warning).toBe('no_planned_payment');
      expect(result.payoffDate).toBeNull();
      expect(result.monthsRemaining).toBeNull();
      expect(result.totalInterestRemaining).toBeNull();
      expect(result.monthlyPrincipal).toBeNull();
      // monthly interest is still shown — it's a property of the current state, not the plan.
      expect(result.monthlyInterest).toBeGreaterThan(0);
      expect(result.paidToDate).toBe(74_899.5);
    });
  });

  describe('payment below monthly interest', () => {
    it('returns a payment_below_interest warning when payment cannot cover accrual', () => {
      const result = computeLoanProjection({
        currentBalanceMinorUnits: 24_510_050,
        originalPrincipalMinorUnits: 32_000_000,
        interestRate: 3.75,
        plannedPaymentMinorUnits: 10_000, // $100 / mo, vastly below monthly interest
        today: TODAY,
        decimals: 2,
      });

      expect(result.warning).toBe('payment_below_interest');
      expect(result.payoffDate).toBeNull();
      expect(result.monthsRemaining).toBeNull();
      // No meaningful "principal per month" exists when nothing is paid down.
      expect(result.monthlyPrincipal).toBeNull();
    });

    it('treats exact equality (payment == interest) as below — no principal would be paid down', () => {
      const balance = 12_000_000; // $120,000
      const apr = 6.0; // 0.5% monthly
      const monthlyInterestCents = (balance * apr) / 100 / 12; // 60,000 cents = $600

      const result = computeLoanProjection({
        currentBalanceMinorUnits: balance,
        originalPrincipalMinorUnits: balance,
        interestRate: apr,
        plannedPaymentMinorUnits: monthlyInterestCents,
        today: TODAY,
        decimals: 2,
      });

      expect(result.warning).toBe('payment_below_interest');
    });
  });

  describe('standard amortization', () => {
    it('matches a hand-computed 30-year mortgage payoff', () => {
      // 30-year mortgage, $200,000 at 6.00% APR. Standard payment for full term
      // is ~$1,199.10. Use a round payment of $1,200 to keep the test stable.
      const result = computeLoanProjection({
        currentBalanceMinorUnits: 200_00 * 1000, // $200,000 in cents
        originalPrincipalMinorUnits: 200_00 * 1000,
        interestRate: 6.0,
        plannedPaymentMinorUnits: 120_000, // $1,200 / month
        today: TODAY,
        decimals: 2,
      });

      expect(result.isPaidOff).toBe(false);
      expect(result.warning).toBeNull();
      expect(result.monthsRemaining).toBe(360);
      expect(result.payoffDate).toBe('2056-06-09');
      // Simulated month-by-month interest at $1200/mo with a partial final
      // payment (the last month clears only what's left, not a full $1200).
      expect(result.totalInterestRemaining).toBeCloseTo(231_096.87, 2);
      // First-month interest on $200k @ 6% APR = $1,000.00.
      expect(result.monthlyInterest).toBeCloseTo(1_000, 1);
      expect(result.monthlyPrincipal).toBeCloseTo(200, 1);
    });

    it('accrues interest only on the actual declining balance — the final month pays just the remainder', () => {
      // $1,000 at 12% APR (1%/mo) paying $500/mo:
      //   m1: interest $10.00 → balance 1010 − 500 = 510
      //   m2: interest  $5.10 → balance 515.10 − 500 = 15.10
      //   m3: interest  $0.15 → final payment of $15.25 clears the loan
      // Total interest = $15.25. A full-final-payment formula
      // (payment × months − balance = 3 × 500 − 1000) would claim $500.
      const result = computeLoanProjection({
        currentBalanceMinorUnits: 100_000,
        originalPrincipalMinorUnits: 100_000,
        interestRate: 12,
        plannedPaymentMinorUnits: 50_000,
        today: TODAY,
        decimals: 2,
      });

      expect(result.monthsRemaining).toBe(3);
      expect(result.totalInterestRemaining).toBe(15.25);
    });

    it('handles zero APR as a degenerate case (no interest, no log formula)', () => {
      const result = computeLoanProjection({
        currentBalanceMinorUnits: 12_000_00, // $12,000
        originalPrincipalMinorUnits: 12_000_00,
        interestRate: 0,
        plannedPaymentMinorUnits: 100_00, // $100 / month
        today: TODAY,
        decimals: 2,
      });

      expect(result.isPaidOff).toBe(false);
      expect(result.warning).toBeNull();
      expect(result.monthsRemaining).toBe(120);
      expect(result.totalInterestRemaining).toBe(0);
      expect(result.monthlyInterest).toBe(0);
      expect(result.monthlyPrincipal).toBe(100);
    });

    it('rounds the final month upward — partial months always finish payoff', () => {
      // $1,000 balance, 0% APR, $300/month → 3.33 months → 4 months projected.
      const result = computeLoanProjection({
        currentBalanceMinorUnits: 1_000_00,
        originalPrincipalMinorUnits: 1_000_00,
        interestRate: 0,
        plannedPaymentMinorUnits: 300_00,
        today: TODAY,
        decimals: 2,
      });

      expect(result.monthsRemaining).toBe(4);
      // The final month pays only the $100 remainder — a zero-interest loan
      // must never report interest, even when the balance doesn't divide
      // evenly by the payment.
      expect(result.totalInterestRemaining).toBe(0);
    });
  });

  describe('paid-to-date metrics', () => {
    it('reports the percentage of the original principal repaid', () => {
      const result = computeLoanProjection({
        currentBalanceMinorUnits: 24_000_000, // $240k remaining
        originalPrincipalMinorUnits: 32_000_000, // out of $320k
        interestRate: 3.75,
        plannedPaymentMinorUnits: 150_000,
        today: TODAY,
        decimals: 2,
      });

      // $80k of $320k paid = 25.0%
      expect(result.paidToDate).toBe(80_000);
      expect(result.paidToDatePercent).toBe(25);
    });

    it('clamps an overpaid loan to 100%', () => {
      const result = computeLoanProjection({
        currentBalanceMinorUnits: -1_000, // $10 overpaid
        originalPrincipalMinorUnits: 32_000_000,
        interestRate: 3.75,
        plannedPaymentMinorUnits: 150_000,
        today: TODAY,
        decimals: 2,
      });

      expect(result.paidToDatePercent).toBe(100);
    });

    it('returns 0 when the original principal is zero (degenerate input)', () => {
      const result = computeLoanProjection({
        currentBalanceMinorUnits: 100,
        originalPrincipalMinorUnits: 0,
        interestRate: 3.75,
        plannedPaymentMinorUnits: 150_000,
        today: TODAY,
        decimals: 2,
      });

      expect(result.paidToDatePercent).toBe(0);
    });
  });

  describe('non-amortizing horizon (zero APR, tiny payment)', () => {
    it('does not amortize within a projectable horizon when a 0% loan has a near-zero payment', () => {
      // $100,000 at 0% APR paid 1¢/month would take ~833M months — beyond any
      // Date horizon, so the projection refuses to amortize instead of emitting "NaN-NaN-NaN".
      const result = computeLoanProjection({
        currentBalanceMinorUnits: 10_000_000, // $100,000
        originalPrincipalMinorUnits: 10_000_000,
        interestRate: 0,
        plannedPaymentMinorUnits: 1, // one cent / month
        today: TODAY,
        decimals: 2,
      });

      expect(result.warning).toBe('payment_below_interest');
      expect(result.payoffDate).toBeNull();
      expect(result.monthsRemaining).toBeNull();
      expect(result.totalInterestRemaining).toBeNull();
      expect(result.isPaidOff).toBe(false);
    });

    it('never emits a NaN payoff date for a 0% loan with a near-zero payment', () => {
      const result = computeLoanProjection({
        currentBalanceMinorUnits: 10_000_000,
        originalPrincipalMinorUnits: 10_000_000,
        interestRate: 0,
        plannedPaymentMinorUnits: 1,
        today: TODAY,
        decimals: 2,
      });

      // A non-amortizing horizon yields no payoff date at all — never the
      // "NaN-NaN-NaN" string an unguarded Date overflow would serialize.
      expect(result.payoffDate).not.toBe('NaN-NaN-NaN');
      expect(result.payoffDate).toBeNull();
    });

    it('still projects a valid payoff for a normal 0% loan inside the horizon', () => {
      // $12,000 at 0% APR, $1,000/month → exactly 12 months, well within the horizon.
      const result = computeLoanProjection({
        currentBalanceMinorUnits: 1_200_000, // $12,000
        originalPrincipalMinorUnits: 1_200_000,
        interestRate: 0,
        plannedPaymentMinorUnits: 100_000, // $1,000 / month
        today: TODAY,
        decimals: 2,
      });

      expect(result.monthsRemaining).toBe(12);
      expect(result.warning).toBeNull();
      expect(result.payoffDate).not.toBeNull();
      expect(result.payoffDate).not.toContain('NaN');
    });
  });

  describe('zero planned payment means no plan, not an underfunded plan', () => {
    it('treats a zero planned payment on an interest-bearing loan as no_planned_payment', () => {
      const result = computeLoanProjection({
        currentBalanceMinorUnits: 24_510_050,
        originalPrincipalMinorUnits: 32_000_000,
        interestRate: 5,
        plannedPaymentMinorUnits: 0,
        today: TODAY,
        decimals: 2,
      });

      expect(result.warning).toBe('no_planned_payment');
      expect(result.monthsRemaining).toBeNull();
      expect(result.monthlyPrincipal).toBeNull();
    });

    it('treats a zero planned payment on a zero-APR loan as no_planned_payment', () => {
      const result = computeLoanProjection({
        currentBalanceMinorUnits: 1_200_000,
        originalPrincipalMinorUnits: 1_200_000,
        interestRate: 0,
        plannedPaymentMinorUnits: 0,
        today: TODAY,
        decimals: 2,
      });

      expect(result.warning).toBe('no_planned_payment');
      expect(result.monthsRemaining).toBeNull();
      expect(result.monthlyPrincipal).toBeNull();
    });

    it('still flags a positive-but-underfunded payment as payment_below_interest', () => {
      // $300,000 at 12% APR accrues $3,000/month interest; a $1,000 payment is
      // positive yet below that accrual, so it never reaches the horizon cap.
      const result = computeLoanProjection({
        currentBalanceMinorUnits: 30_000_000, // $300,000
        originalPrincipalMinorUnits: 30_000_000,
        interestRate: 12,
        plannedPaymentMinorUnits: 100_000, // $1,000 / month
        today: TODAY,
        decimals: 2,
      });

      expect(result.warning).toBe('payment_below_interest');
      expect(result.monthsRemaining).toBeNull();
      expect(result.monthlyPrincipal).toBeNull();
    });

    it('still treats a null planned payment as no_planned_payment', () => {
      const result = computeLoanProjection({
        currentBalanceMinorUnits: 24_510_050,
        originalPrincipalMinorUnits: 32_000_000,
        interestRate: 5,
        plannedPaymentMinorUnits: null,
        today: TODAY,
        decimals: 2,
      });

      expect(result.warning).toBe('no_planned_payment');
      expect(result.monthsRemaining).toBeNull();
      expect(result.monthlyPrincipal).toBeNull();
    });
  });

  describe('estimatedInterestPaid (amortization-schedule estimate)', () => {
    // $1,000 at 12% APR (1%/mo) over a 3-month term. Scheduled payment is
    // 34,002 cents; month-by-month accrual of the full schedule:
    //   m1: 1,000¢ → m2: 670¢ → m3: 337¢ = 2,007¢ ($20.07) lifetime interest.
    const TERM_LOAN = {
      originalPrincipalMinorUnits: 100_000,
      interestRate: 12,
      termMonths: 3,
      today: TODAY,
      decimals: 2,
    };

    it('is null when the loan has no term — there is no schedule to derive from', () => {
      const result = computeLoanProjection({
        ...TERM_LOAN,
        termMonths: null,
        currentBalanceMinorUnits: 100_000,
        plannedPaymentMinorUnits: 120_000,
      });

      expect(result.estimatedInterestPaid).toBeNull();
      // The sibling forward-looking field is unaffected by a missing term.
      expect(result.totalInterestRemaining).not.toBeNull();
    });

    it('is null whenever totalInterestRemaining is null (no planned payment)', () => {
      const result = computeLoanProjection({
        ...TERM_LOAN,
        currentBalanceMinorUnits: 100_000,
        plannedPaymentMinorUnits: null,
      });

      expect(result.totalInterestRemaining).toBeNull();
      expect(result.estimatedInterestPaid).toBeNull();
    });

    it('is null whenever totalInterestRemaining is null (payment below interest)', () => {
      const result = computeLoanProjection({
        ...TERM_LOAN,
        currentBalanceMinorUnits: 100_000,
        plannedPaymentMinorUnits: 500, // below the 1,000¢ first-month interest
      });

      expect(result.warning).toBe('payment_below_interest');
      expect(result.estimatedInterestPaid).toBeNull();
    });

    it('is zero on a fresh loan paying exactly the scheduled payment', () => {
      const result = computeLoanProjection({
        ...TERM_LOAN,
        currentBalanceMinorUnits: 100_000, // untouched principal
        plannedPaymentMinorUnits: 34_002, // the amortized payment for the 3-month schedule
      });

      expect(result.totalInterestRemaining).toBe(20.07);
      expect(result.estimatedInterestPaid).toBe(0);
    });

    it('reports the scheduled share consumed so far on a mid-term loan', () => {
      // Half the principal remains; at a $1,200 payment it clears in one month
      // costing 500¢ interest → estimate = 2,007 − 500 = 1,507¢ ($15.07).
      const result = computeLoanProjection({
        ...TERM_LOAN,
        currentBalanceMinorUnits: 50_000,
        plannedPaymentMinorUnits: 120_000,
      });

      expect(result.totalInterestRemaining).toBe(5);
      expect(result.estimatedInterestPaid).toBe(15.07);
    });

    it('falls back to the full scheduled lifetime interest on a paid-off loan with no settle information', () => {
      const result = computeLoanProjection({
        ...TERM_LOAN,
        currentBalanceMinorUnits: 0,
        plannedPaymentMinorUnits: 120_000,
      });

      expect(result.isPaidOff).toBe(true);
      expect(result.estimatedInterestPaid).toBe(20.07);
    });

    describe('paid-off estimate capped to the months the loan was open', () => {
      // The 3-month schedule accrues 1,000¢ (m1) + 670¢ (m2) + 337¢ (m3);
      // cumulative: 1 month = $10.00, 2 months = $16.70, 3+ months = $20.07.
      const PAID_OFF = {
        ...TERM_LOAN,
        currentBalanceMinorUnits: 0,
        plannedPaymentMinorUnits: 120_000,
        startDate: '2026-01-15',
      };

      it('accrues one scheduled month when the loan settles within its first month (partial month ceils)', () => {
        const result = computeLoanProjection({ ...PAID_OFF, settleDate: '2026-02-04' });

        expect(result.isPaidOff).toBe(true);
        expect(result.estimatedInterestPaid).toBe(10);
      });

      it('accrues two scheduled months when the loan settles one full month plus a partial one after start', () => {
        const result = computeLoanProjection({ ...PAID_OFF, settleDate: '2026-03-01' });

        expect(result.estimatedInterestPaid).toBe(16.7);
      });

      it('counts an exact month boundary as that many months, without a partial bump', () => {
        const result = computeLoanProjection({ ...PAID_OFF, settleDate: '2026-03-15' });

        expect(result.estimatedInterestPaid).toBe(16.7);
      });

      it('is zero when the loan settles on its start date', () => {
        const result = computeLoanProjection({ ...PAID_OFF, settleDate: '2026-01-15' });

        expect(result.estimatedInterestPaid).toBe(0);
      });

      it('clamps to zero months when the settle date is before the start date', () => {
        const result = computeLoanProjection({ ...PAID_OFF, settleDate: '2026-01-10' });

        expect(result.estimatedInterestPaid).toBe(0);
      });

      it('reproduces the full lifetime figure when the loan ran to (or past) its term', () => {
        const atTerm = computeLoanProjection({ ...PAID_OFF, settleDate: '2026-04-15' });
        const pastTerm = computeLoanProjection({ ...PAID_OFF, settleDate: '2030-08-01' });

        expect(atTerm.estimatedInterestPaid).toBe(20.07);
        expect(pastTerm.estimatedInterestPaid).toBe(20.07);
      });

      it('accepts a full ISO timestamp as the settle date', () => {
        const result = computeLoanProjection({ ...PAID_OFF, settleDate: '2026-02-20T14:30:00.000Z' });

        expect(result.estimatedInterestPaid).toBe(16.7);
      });

      it('falls back to the lifetime figure when only one of startDate/settleDate is known', () => {
        const noSettle = computeLoanProjection({ ...PAID_OFF, settleDate: null });
        const noStart = computeLoanProjection({ ...PAID_OFF, startDate: null, settleDate: '2026-02-04' });

        expect(noSettle.estimatedInterestPaid).toBe(20.07);
        expect(noStart.estimatedInterestPaid).toBe(20.07);
      });

      it('falls back to the lifetime figure when a date is unparsable', () => {
        const result = computeLoanProjection({ ...PAID_OFF, settleDate: 'not-a-date' });

        expect(result.estimatedInterestPaid).toBe(20.07);
      });

      it('does not affect an active loan — start/settle inputs only shape the paid-off estimate', () => {
        const withDates = computeLoanProjection({
          ...TERM_LOAN,
          currentBalanceMinorUnits: 50_000,
          plannedPaymentMinorUnits: 120_000,
          startDate: '2026-01-15',
          settleDate: '2026-02-04',
        });
        const withoutDates = computeLoanProjection({
          ...TERM_LOAN,
          currentBalanceMinorUnits: 50_000,
          plannedPaymentMinorUnits: 120_000,
        });

        expect(withDates).toEqual(withoutDates);
        expect(withDates.estimatedInterestPaid).toBe(15.07);
      });
    });

    it('clamps to zero when the payoff trajectory outpaces the contractual schedule', () => {
      // $200/mo pays the full principal off slower than the 3-month schedule,
      // so remaining interest (~3,100¢) exceeds the 2,007¢ scheduled lifetime
      // — the difference must clamp instead of going negative.
      const result = computeLoanProjection({
        ...TERM_LOAN,
        currentBalanceMinorUnits: 100_000,
        plannedPaymentMinorUnits: 20_000,
      });

      expect(result.estimatedInterestPaid).toBe(0);
    });
  });

  describe('determinism', () => {
    it('returns the same result when called repeatedly with the same input', () => {
      const input = {
        currentBalanceMinorUnits: 24_510_050,
        originalPrincipalMinorUnits: 32_000_000,
        interestRate: 3.75,
        plannedPaymentMinorUnits: 150_000,
        today: TODAY,
        decimals: 2,
      };

      expect(computeLoanProjection(input)).toEqual(computeLoanProjection(input));
    });

    it('uses the injected `today` to anchor payoffDate, not the wall clock', () => {
      const earlyToday = new Date('2026-01-15T00:00:00Z');
      const lateToday = new Date('2026-12-15T00:00:00Z');

      const early = computeLoanProjection({
        currentBalanceMinorUnits: 1_000_00,
        originalPrincipalMinorUnits: 1_000_00,
        interestRate: 0,
        plannedPaymentMinorUnits: 100_00,
        today: earlyToday,
        decimals: 2,
      });
      const late = computeLoanProjection({
        currentBalanceMinorUnits: 1_000_00,
        originalPrincipalMinorUnits: 1_000_00,
        interestRate: 0,
        plannedPaymentMinorUnits: 100_00,
        today: lateToday,
        decimals: 2,
      });

      expect(early.payoffDate).toBe('2026-11-15');
      expect(late.payoffDate).toBe('2027-10-15');
    });

    it('clamps payoffDate to the last day of short months instead of overflowing', () => {
      // Jan 31 + N months must land on the target month's last day (Feb 28,
      // Apr 30), not overflow into the following month via Date normalization.
      const todayJan31 = new Date(2026, 0, 31);

      const oneMonth = computeLoanProjection({
        currentBalanceMinorUnits: 100_00,
        originalPrincipalMinorUnits: 100_00,
        interestRate: 0,
        plannedPaymentMinorUnits: 100_00,
        today: todayJan31,
        decimals: 2,
      });
      expect(oneMonth.monthsRemaining).toBe(1);
      expect(oneMonth.payoffDate).toBe('2026-02-28');

      const threeMonths = computeLoanProjection({
        currentBalanceMinorUnits: 300_00,
        originalPrincipalMinorUnits: 300_00,
        interestRate: 0,
        plannedPaymentMinorUnits: 100_00,
        today: todayJan31,
        decimals: 2,
      });
      expect(threeMonths.monthsRemaining).toBe(3);
      expect(threeMonths.payoffDate).toBe('2026-04-30');
    });
  });

  describe('decimals', () => {
    it('projects a zero-interest KWD loan of 1000.001 with a payment of 1000 over 2 months', () => {
      const result = computeLoanProjection({
        currentBalanceMinorUnits: 1_000_001,
        originalPrincipalMinorUnits: 1_000_001,
        interestRate: 0,
        plannedPaymentMinorUnits: 1_000_000,
        today: TODAY,
        decimals: 3,
      });

      expect(result.monthsRemaining).toBe(2);
      expect(result.totalInterestRemaining).toBe(0);
      expect(result.monthlyPrincipal).toBe(1000);
    });

    it('reports KWD paid-to-date, monthly interest and monthly principal at 3 decimals', () => {
      const result = computeLoanProjection({
        currentBalanceMinorUnits: 990_000,
        originalPrincipalMinorUnits: 1_000_125,
        interestRate: 12,
        plannedPaymentMinorUnits: 100_000,
        today: TODAY,
        decimals: 3,
      });

      expect(result.paidToDate).toBe(10.125);
      // 990 KWD at 1% a month
      expect(result.monthlyInterest).toBe(9.9);
      expect(result.monthlyPrincipal).toBe(90.1);
    });

    it('rounds the monthly interest to a whole unit for a 0-decimal currency', () => {
      const result = computeLoanProjection({
        currentBalanceMinorUnits: 1_000_050,
        originalPrincipalMinorUnits: 1_000_050,
        interestRate: 12,
        plannedPaymentMinorUnits: 100_000,
        today: TODAY,
        decimals: 0,
      });

      // 10_000.5 half-even is 10_000
      expect(result.monthlyInterest).toBe(10_000);
      expect(result.paidToDate).toBe(0);
    });
  });
});
