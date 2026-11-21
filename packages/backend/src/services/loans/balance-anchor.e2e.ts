import { TRANSACTION_TRANSFER_NATURE, type RecordId } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { AED_PER_USD } from '@tests/mocks/exchange-rates/data';
import { addDays, format, subDays } from 'date-fns';

/** Yesterday as a yyyy-MM-dd string. */
const YESTERDAY = format(subDays(new Date(), 1), 'yyyy-MM-dd');

/** Today as a yyyy-MM-dd string, matching the anchor date set at loan creation. */
const TODAY = format(new Date(), 'yyyy-MM-dd');

/** Tomorrow as a yyyy-MM-dd string — within the server's +1 day timezone grace. */
const TOMORROW = format(addDays(new Date(), 1), 'yyyy-MM-dd');

/** ISO timestamp 30 days in the past — safely before the creation-date anchor. */
const PAST_ISO = subDays(new Date(), 30).toISOString();

/** Base-currency loan: originalPrincipal=250000, initialBalance=175000 → currentBalance=-175000, paidToDate=75000, anchor=today. */
function buildAnchorLoanPayload(overrides: Record<string, unknown> = {}) {
  return helpers.buildCreateLoanPayload({
    currencyCode: global.BASE_CURRENCY_CODE,
    originalPrincipal: 250_000,
    initialBalance: 175_000,
    ...overrides,
  });
}

describe('Loan balance anchor', () => {
  describe('initial state', () => {
    it('sets balanceAnchorDate to today and paidToDate = originalPrincipal − |currentBalance| at creation', async () => {
      const loan = await helpers.createLoan({
        payload: buildAnchorLoanPayload(),
        raw: true,
      });

      expect(loan.currentBalance).toBe(-175_000);
      expect(loan.loanDetails.balanceAnchorDate).toBe(TODAY);
      expect(loan.projection.paidToDate).toBe(75_000);
    });
  });

  describe('pre-anchor payments are informational', () => {
    it('a pre-anchor transfer_to_loan does not move the outstanding or paidToDate, and deleting it is a no-op', async () => {
      // Back-tagging a payment before the anchor must not move the balance — it's already baked into the opening snapshot.
      const loan = await helpers.createLoan({
        payload: buildAnchorLoanPayload(),
        raw: true,
      });
      const sourceAccount = await helpers.createAccount({ raw: true });

      // Payment dated 30 days in the past — strictly before the anchor (today).
      const [base] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: sourceAccount.id,
            amount: 5_000,
            time: PAST_ISO,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 5_000,
          destinationAccountId: loan.id as RecordId,
        },
        raw: true,
      });

      expect(base).toBeDefined();

      const reloaded = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloaded.currentBalance).toBe(-175_000);
      expect(reloaded.projection.paidToDate).toBe(75_000);
      // A pre-anchor payment must not shift the anchor forward — it stays pinned to the creation date.
      expect(reloaded.loanDetails.balanceAnchorDate).toBe(TODAY);

      await helpers.deleteTransaction({ id: base.id });

      const afterDelete = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(afterDelete.currentBalance).toBe(-175_000);
      expect(afterDelete.projection.paidToDate).toBe(75_000);
    });
  });

  describe('on/after-anchor payments reduce the outstanding', () => {
    it('deleting an on/after-anchor payment restores the outstanding and paidToDate', async () => {
      const loan = await helpers.createLoan({
        payload: buildAnchorLoanPayload(),
        raw: true,
      });
      const sourceAccount = await helpers.createAccount({ raw: true });

      const [base] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: sourceAccount.id,
            amount: 5_000,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 5_000,
          destinationAccountId: loan.id as RecordId,
        },
        raw: true,
      });

      const afterPayment = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(afterPayment.currentBalance).toBe(-170_000);
      expect(afterPayment.projection.paidToDate).toBe(80_000);

      await helpers.deleteTransaction({ id: base.id });

      const restored = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(restored.currentBalance).toBe(-175_000);
      expect(restored.projection.paidToDate).toBe(75_000);
    });

    it('attempting to unlink a transfer_to_loan payment is rejected with 422 (delete is the only undo path)', async () => {
      // Unlinking would orphan the loan-side income leg as a standalone transaction, which the loan-account write guard forbids — deletion is the only supported undo path.
      const loan = await helpers.createLoan({
        payload: buildAnchorLoanPayload(),
        raw: true,
      });
      const sourceAccount = await helpers.createAccount({ raw: true });

      const [base] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: sourceAccount.id,
            amount: 5_000,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 5_000,
          destinationAccountId: loan.id as RecordId,
        },
        raw: true,
      });

      const afterPayment = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(afterPayment.currentBalance).toBe(-170_000);

      const unlinkResponse = await helpers.unlinkTransferTransactions({
        transferIds: [base.transferId as string],
        raw: false,
      });
      expect(unlinkResponse.statusCode).toBe(422);

      const stillPaid = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(stillPaid.currentBalance).toBe(-170_000);
      expect(stillPaid.projection.paidToDate).toBe(80_000);
    });
  });

  describe('balance correction re-anchors the loan', () => {
    it('PATCH /loans/:id with currentBalance re-states the outstanding, updates paidToDate, and records a balance_correction event with the new anchor date', async () => {
      const loan = await helpers.createLoan({
        payload: buildAnchorLoanPayload(),
        raw: true,
      });

      // 175000 → 160000 correction; paidToDate = 250000 − 160000 = 90000.
      const updated = await helpers.updateLoan({
        id: loan.id,
        payload: { currentBalance: 160_000, currentBalanceAsOf: TODAY },
        raw: true,
      });

      // API stores balance negative (liability convention).
      expect(updated.currentBalance).toBe(-160_000);
      expect(updated.projection.paidToDate).toBe(90_000);
      expect(updated.loanDetails.balanceAnchorDate).toBe(TODAY);

      const correctionEvent = updated.loanDetails.events.find((e) => e.type === 'balance_correction');
      expect(correctionEvent).toBeDefined();
      if (correctionEvent?.type === 'balance_correction') {
        expect(correctionEvent.from).toBe(175_000);
        expect(correctionEvent.to).toBe(160_000);
      }
    });
  });

  describe('cross-currency (FX) recompute', () => {
    const USD_TO_AED = AED_PER_USD;

    it('pins refCurrentBalance to the spot value after a payment and settles it to zero at zero native outstanding', async () => {
      // The recompute path measures refCurrentBalance as a SPOT conversion of the
      // floored native outstanding — not the ref anchor plus historical-rate payment
      // legs. Base currency is AED, so a USD loan forces a distinct ref balance.
      await helpers.addUserCurrencies({ currencyCodes: ['USD'] });

      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          currencyCode: 'USD',
          originalPrincipal: 10_000,
          initialBalance: 8_000,
        }),
        raw: true,
      });

      expect(loan.refCurrentBalance).toBeDefined();
      // Outstanding is negative (liability convention), and the ref side is negative too.
      expect(loan.currentBalance).toBe(-8_000);
      expect(loan.refCurrentBalance).toBeLessThan(0);

      const sourceAccount = await helpers.createAccount({ raw: true });

      // Post-anchor payment (today) of 1000 USD → outstanding moves to -7000.
      await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: sourceAccount.id,
            amount: 1_000,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 1_000,
          destinationAccountId: loan.id as RecordId,
        },
        raw: true,
      });

      const afterPartialPayment = await helpers.getLoanById({ id: loan.id, raw: true });

      // Native outstanding dropped by the payment amount…
      expect(afterPartialPayment.currentBalance).toBe(-7_000);
      // …and refCurrentBalance is the spot measure of that native outstanding, NOT
      // the pre-payment ref plus the payment's historical-rate refAmount.
      expect(afterPartialPayment.refCurrentBalance).toBeCloseTo(afterPartialPayment.currentBalance * USD_TO_AED, 2);

      await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: sourceAccount.id,
            amount: 7_000,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 7_000,
          destinationAccountId: loan.id as RecordId,
        },
        raw: true,
      });

      const settled = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(settled.currentBalance).toBe(0);
      // Spot of a zero native balance is exactly zero — no historical-rate residue.
      expect(settled.refCurrentBalance).toBe(0);
    });
  });

  describe('anchor date manipulation', () => {
    it('keeps later payments counted when the anchor moves backward, and re-counts same-day ones (inclusive >= boundary)', async () => {
      // Loan created with outstanding 10000, anchor = today.
      const loan = await helpers.createLoan({
        payload: buildAnchorLoanPayload({
          originalPrincipal: 10_000,
          initialBalance: 10_000,
        }),
        raw: true,
      });

      expect(loan.currentBalance).toBe(-10_000);

      const sourceAccount = await helpers.createAccount({ raw: true });

      // Payment of 2000 dated today — on the anchor, so it counts.
      await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: sourceAccount.id,
            amount: 2_000,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 2_000,
          destinationAccountId: loan.id as RecordId,
        },
        raw: true,
      });

      const afterPayment = await helpers.getLoanById({ id: loan.id, raw: true });
      // 10000 − 2000 = 8000 outstanding.
      expect(afterPayment.currentBalance).toBe(-8_000);

      // Move anchor back to yesterday with corrected balance 7000; the today-dated 2000
      // payment is still on/after the new anchor, so it keeps reducing the outstanding.
      await helpers.updateLoan({
        id: loan.id,
        payload: { currentBalance: 7_000, currentBalanceAsOf: YESTERDAY },
        raw: true,
      });

      const afterBackwardAnchor = await helpers.getLoanById({ id: loan.id, raw: true });
      // 7000 − 2000 (still post-anchor) = 5000 outstanding.
      expect(afterBackwardAnchor.currentBalance).toBe(-5_000);
      // The projected balance stays negative, so the correction is accepted and recorded.
      expect(afterBackwardAnchor.loanDetails.events.filter((e) => e.type === 'balance_correction')).toHaveLength(1);

      await helpers.updateLoan({
        id: loan.id,
        payload: { currentBalance: 10_000, currentBalanceAsOf: TODAY },
        raw: true,
      });

      const reloaded = await helpers.getLoanById({ id: loan.id, raw: true });
      // Corrected opening 10000 minus the same-day 2000 payment (still counted) = 8000.
      expect(reloaded.currentBalance).toBe(-8_000);
    });

    it('editing a payment date across the anchor boundary toggles whether it reduces the outstanding', async () => {
      // Loan created with outstanding 10000, anchor = today.
      const loan = await helpers.createLoan({
        payload: buildAnchorLoanPayload({
          originalPrincipal: 10_000,
          initialBalance: 10_000,
        }),
        raw: true,
      });

      const sourceAccount = await helpers.createAccount({ raw: true });

      // Payment of 1000 dated 30 days ago — strictly pre-anchor → informational.
      const [base] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: sourceAccount.id,
            amount: 1_000,
            time: PAST_ISO,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 1_000,
          destinationAccountId: loan.id as RecordId,
        },
        raw: true,
      });

      const afterPreAnchor = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(afterPreAnchor.currentBalance).toBe(-10_000);

      // Move the payment date to today — it now crosses into the counted window.
      await helpers.updateTransaction({
        id: base.id,
        payload: { time: new Date().toISOString() },
        raw: false,
      });

      const afterCrossForward = await helpers.getLoanById({ id: loan.id, raw: true });
      // Payment is now post-anchor: 10000 − 1000 = 9000.
      expect(afterCrossForward.currentBalance).toBe(-9_000);

      // Move the payment date back to the past — it becomes informational again.
      await helpers.updateTransaction({
        id: base.id,
        payload: { time: PAST_ISO },
        raw: false,
      });

      const afterCrossBack = await helpers.getLoanById({ id: loan.id, raw: true });
      // Payment is pre-anchor again — outstanding restored to 10000.
      expect(afterCrossBack.currentBalance).toBe(-10_000);
    });

    it('rejects a date-only edit that would carry a pre-anchor payment across the anchor into overpay', async () => {
      // A pre-anchor payment is NOT reflected in the outstanding, so moving it
      // past the anchor adds its FULL amount to the post-anchor sum. The overpay
      // assertion must treat it as a brand-new payment, not net it out against
      // itself — otherwise the edit sails through and the loan goes into credit.
      const loan = await helpers.createLoan({
        payload: buildAnchorLoanPayload({
          originalPrincipal: 1_000,
          initialBalance: 1_000,
        }),
        raw: true,
      });
      const sourceAccount = await helpers.createAccount({ raw: true });

      // Post-anchor payment of 700 — outstanding drops to 300.
      await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: sourceAccount.id,
            amount: 700,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 700,
          destinationAccountId: loan.id as RecordId,
        },
        raw: true,
      });

      // Informational pre-anchor payment of 500 — allowed, balance untouched.
      const [preAnchorBase] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: sourceAccount.id,
            amount: 500,
            time: PAST_ISO,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 500,
          destinationAccountId: loan.id as RecordId,
        },
        raw: true,
      });

      const beforeEdit = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(beforeEdit.currentBalance).toBe(-300);

      // Re-dating the 500 payment to today would recompute the outstanding to
      // -1000 + 700 + 500 = +200 — an overpaid loan. Must reject.
      const response = await helpers.updateTransaction({
        id: preAnchorBase.id,
        payload: { time: new Date().toISOString() },
        raw: false,
      });

      expect(response.statusCode).toBe(422);

      const afterEdit = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(afterEdit.currentBalance).toBe(-300);
    });
  });

  describe('balance correction overpay guard', () => {
    /** Two months back — a re-anchor date safely earlier than PAST_ISO payments. */
    const TWO_MONTHS_AGO = format(subDays(new Date(), 60), 'yyyy-MM-dd');

    it('rejects with 422 a re-anchor that projects positive across a later payment, and leaves the loan untouched', async () => {
      const loan = await helpers.createLoan({
        payload: buildAnchorLoanPayload({
          originalPrincipal: 1_100,
          initialBalance: 1_100,
        }),
        raw: true,
      });
      const sourceAccount = await helpers.createAccount({ raw: true });

      // Payment of 500 dated 30 days ago — pre-anchor (anchor = today), informational.
      await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: sourceAccount.id,
            amount: 500,
            time: PAST_ISO,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 500,
          destinationAccountId: loan.id as RecordId,
        },
        raw: true,
      });

      // Correcting to 100 as-of two months ago pulls the 30-day-old 500 payment
      // into the post-anchor window: −100 + 500 = +400 projected — overpaid.
      const response = await helpers.updateLoan({
        id: loan.id,
        payload: { currentBalance: 100, currentBalanceAsOf: TWO_MONTHS_AGO },
        raw: false,
      });
      expect(response.statusCode).toBe(422);

      // Full rollback: balance, anchor, and events all untouched.
      const reloaded = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloaded.currentBalance).toBe(-1_100);
      expect(reloaded.loanDetails.balanceAnchorDate).toBe(TODAY);
      expect(reloaded.loanDetails.events.some((e) => e.type === 'balance_correction')).toBe(false);
      expect(reloaded.loanDetails.events.some((e) => e.type === 'paid_off')).toBe(false);
    });

    it('rejects with 422 a same-day correction overshot by a payment dated on the as-of day (inclusive boundary)', async () => {
      const loan = await helpers.createLoan({
        payload: buildAnchorLoanPayload({
          originalPrincipal: 1_100,
          initialBalance: 1_100,
        }),
        raw: true,
      });
      const sourceAccount = await helpers.createAccount({ raw: true });

      // Payment of 500 dated today — post-anchor, outstanding drops to 600.
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

      const afterPayment = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(afterPayment.currentBalance).toBe(-600);

      // The >= anchor boundary keeps today's 500 payment counted, so asserting
      // 100 as-of today projects −100 + 500 = +400 — overpaid.
      const response = await helpers.updateLoan({
        id: loan.id,
        payload: { currentBalance: 100, currentBalanceAsOf: TODAY },
        raw: false,
      });
      expect(response.statusCode).toBe(422);

      const reloaded = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloaded.currentBalance).toBe(-600);
      expect(reloaded.loanDetails.events.some((e) => e.type === 'balance_correction')).toBe(false);
    });

    it('accepts a correction that projects exactly zero and stamps paid_off exactly once', async () => {
      const loan = await helpers.createLoan({
        payload: buildAnchorLoanPayload({
          originalPrincipal: 1_000,
          initialBalance: 1_000,
        }),
        raw: true,
      });
      const sourceAccount = await helpers.createAccount({ raw: true });

      // Payment of 500 dated 30 days ago — pre-anchor, informational for now.
      await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: sourceAccount.id,
            amount: 500,
            time: PAST_ISO,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 500,
          destinationAccountId: loan.id as RecordId,
        },
        raw: true,
      });

      // Asserting 500 as-of two months ago folds the later 500 payment back in:
      // −500 + 500 = 0 — a legit backdated payoff, allowed through.
      const updated = await helpers.updateLoan({
        id: loan.id,
        payload: { currentBalance: 500, currentBalanceAsOf: TWO_MONTHS_AGO },
        raw: true,
      });

      expect(updated.currentBalance).toBe(0);

      const reloaded = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloaded.currentBalance).toBe(0);
      expect(reloaded.loanDetails.events.filter((e) => e.type === 'balance_correction')).toHaveLength(1);
      expect(reloaded.loanDetails.events.filter((e) => e.type === 'paid_off')).toHaveLength(1);
    });

    it('stamps paid_off with the as-of date when a backdated correction to zero settles the loan', async () => {
      const loan = await helpers.createLoan({
        payload: buildAnchorLoanPayload({
          originalPrincipal: 1_000,
          initialBalance: 1_000,
        }),
        raw: true,
      });

      // No payment legs at all — the correction itself is the payoff, so the
      // settlement moment is the asserted as-of date, not the PATCH wall-clock.
      const updated = await helpers.updateLoan({
        id: loan.id,
        payload: { currentBalance: 0, currentBalanceAsOf: TWO_MONTHS_AGO },
        raw: true,
      });

      expect(updated.currentBalance).toBe(0);
      const paidOffEvents = updated.loanDetails.events.filter((e) => e.type === 'paid_off');
      expect(paidOffEvents).toHaveLength(1);
      if (paidOffEvents[0]?.type === 'paid_off') {
        expect(paidOffEvents[0].at.slice(0, 10)).toBe(TWO_MONTHS_AGO);
      }
    });
  });

  describe('balance correction validation', () => {
    it('bounds currentBalanceAsOf at today plus a one-day timezone grace', async () => {
      const loan = await helpers.createLoan({
        payload: buildAnchorLoanPayload(),
        raw: true,
      });

      const farFuture = await helpers.updateLoan({
        id: loan.id,
        payload: { currentBalance: 5_000, currentBalanceAsOf: '2099-01-01' },
        raw: false,
      });
      expect(farFuture.statusCode).toBe(422);

      const pastGrace = await helpers.updateLoan({
        id: loan.id,
        payload: { currentBalance: 5_000, currentBalanceAsOf: format(addDays(new Date(), 2), 'yyyy-MM-dd') },
        raw: false,
      });
      expect(pastGrace.statusCode).toBe(422);

      // A user ahead of the server's timezone can legitimately be on a date the server
      // still reads as tomorrow; the +1 day grace lets that real "today" through (the
      // form enforces the exact local-today bound).
      const withinGrace = await helpers.updateLoan({
        id: loan.id,
        payload: { currentBalance: 5_000, currentBalanceAsOf: TOMORROW },
        raw: false,
      });
      expect(withinGrace.statusCode).toBe(200);
    });
  });

  describe('balance correction cannot predate the loan start date', () => {
    // Origination fixed 10 days in the past, leaving room on both sides of the
    // boundary (11 days back = before, 5 days back = after) without touching "future".
    const START_DATE = format(subDays(new Date(), 10), 'yyyy-MM-dd');

    it('rejects a currentBalanceAsOf before the loan startDate and accepts one on or after it', async () => {
      const loan = await helpers.createLoan({
        payload: buildAnchorLoanPayload({ startDate: START_DATE }),
        raw: true,
      });

      const beforeStart = await helpers.updateLoan({
        id: loan.id,
        payload: { currentBalance: 160_000, currentBalanceAsOf: format(subDays(new Date(), 11), 'yyyy-MM-dd') },
        raw: false,
      });
      expect(beforeStart.statusCode).toBe(422);

      const onStart = await helpers.updateLoan({
        id: loan.id,
        payload: { currentBalance: 160_000, currentBalanceAsOf: START_DATE },
        raw: false,
      });
      expect(onStart.statusCode).toBe(200);

      const afterStart = await helpers.updateLoan({
        id: loan.id,
        payload: { currentBalance: 155_000, currentBalanceAsOf: format(subDays(new Date(), 5), 'yyyy-MM-dd') },
        raw: false,
      });
      expect(afterStart.statusCode).toBe(200);
    });
  });
});
