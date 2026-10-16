import type { LoanEvent } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import Accounts from '@models/accounts.model';
import LoanDetails from '@models/loan-details.model';
import { updateAccount } from '@services/accounts.service';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';
import { withTransaction } from '@services/common/with-transaction';
import { utcDayKey } from '@services/loans/anchor-day';
import { projectLoanOverpay, sumPostAnchorPaymentLegs } from '@services/loans/project-loan-overpay';
import { recomputeLoanBalance } from '@services/loans/recompute-loan-balance.service';

import type { UpdateLoanBody } from './zod-schemas';

interface UpdateLoanParams extends UpdateLoanBody {
  userId: number;
  accountId: string;
  /**
   * Internal-only, not part of the PATCH API: POST /loans/:id/events translates
   * its body.text into this field so both endpoints share one service.
   */
  appendNote?: string;
}

const updateLoanImpl = async (params: UpdateLoanParams) => {
  const { userId, accountId, name, currentBalance, currentBalanceAsOf, appendNote, ...detailFields } = params;

  const loan = await findOrThrowNotFound({
    query: LoanDetails.findOne({
      where: { accountId, userId },
      include: [{ model: Accounts, as: 'account' }],
    }),
    message: t({ key: 'loans.loanNotFound' }),
  });

  const now = new Date();
  const newEvents: LoanEvent[] = [];
  const detailUpdates: Record<string, unknown> = {};

  if (detailFields.interestRate !== undefined && loan.interestRate !== detailFields.interestRate) {
    newEvents.push({
      type: 'rate_change',
      at: now.toISOString(),
      from: loan.interestRate,
      to: detailFields.interestRate,
    });
    detailUpdates.interestRate = detailFields.interestRate;
  }

  if (detailFields.termMonths !== undefined && detailFields.termMonths !== loan.termMonths) {
    // `null` is a meaningful value here ("no term set") — recorded as-is so
    // the timeline can distinguish "term cleared" from "term set to N months".
    newEvents.push({
      type: 'term_change',
      at: now.toISOString(),
      from: loan.termMonths,
      to: detailFields.termMonths ?? null,
    });
    detailUpdates.termMonths = detailFields.termMonths;
  }

  if (detailFields.plannedPayment !== undefined) {
    const current = loan.plannedPayment;
    const next = detailFields.plannedPayment;
    const changed = current === null || next === null ? current !== next : !current.equals(next);
    if (changed) {
      // `null` means "no planned payment set" — recorded as-is so the
      // timeline can distinguish "cleared" from "set to zero".
      newEvents.push({
        type: 'planned_payment_change',
        at: now.toISOString(),
        fromCents: current === null ? null : current.toNumber(),
        toCents: next === null ? null : next.toNumber(),
      });
      detailUpdates.plannedPayment = detailFields.plannedPayment;
      detailUpdates.refPlannedPayment =
        detailFields.plannedPayment === null
          ? null
          : await calculateRefAmount({
              userId,
              amount: detailFields.plannedPayment,
              baseCode: loan.account.currencyCode,
              date: now,
            });
    }
  }

  if (detailFields.minPayment !== undefined) {
    detailUpdates.minPayment = detailFields.minPayment;
    detailUpdates.refMinPayment =
      detailFields.minPayment === null
        ? null
        : await calculateRefAmount({
            userId,
            amount: detailFields.minPayment,
            baseCode: loan.account.currencyCode,
            date: now,
          });
  }

  if (detailFields.startDate !== undefined) detailUpdates.startDate = detailFields.startDate;
  if (detailFields.paymentDayOfMonth !== undefined) detailUpdates.paymentDayOfMonth = detailFields.paymentDayOfMonth;
  if (detailFields.lenderName !== undefined) detailUpdates.lenderName = detailFields.lenderName;
  if (detailFields.accountNumber !== undefined) detailUpdates.accountNumber = detailFields.accountNumber;

  if (appendNote !== undefined) {
    newEvents.push({ type: 'note', at: now.toISOString(), text: appendNote });
  }

  // API takes a positive outstanding amount; loan accounts persist it negated
  // (liability convention). An echo of the current balance WITHOUT an as-of date
  // is dropped (no bogus event, anchor stays); with `currentBalanceAsOf` it is a
  // genuine re-anchor — the same amount asserted on a different date changes
  // which payment legs count as post-anchor.
  const balanceDiffers = currentBalance !== undefined && !currentBalance.negate().equals(loan.account.currentBalance);
  let anchorInitialBalance: Money | null = null;
  let anchorRefInitialBalance: Money | null = null;

  if (currentBalance !== undefined && (balanceDiffers || currentBalanceAsOf !== undefined)) {
    // A correction moves the balance anchor: the new amount becomes
    // Accounts.initialBalance on the asserted date and `recomputeLoanBalance`
    // folds in post-anchor payment legs. The boundary is inclusive (legs dated
    // >= anchor date count), so the corrected amount is the outstanding *before*
    // that day's payments — keeps "create loan today, log today's payment"
    // working. Accepted trade-off: correcting to a post-payment statement
    // balance on the day that payment is logged applies it twice.
    //
    // The default anchor uses the UTC calendar day so it matches how the SQL
    // `DATE("time")` payment filter classifies same-day legs on non-UTC servers.
    const asOfDate = currentBalanceAsOf ?? utcDayKey({ date: now });

    // The outstanding balance can't be known before the loan originated. The
    // start date may be set in this same PATCH (`detailFields.startDate`) or,
    // if untouched, taken from the persisted row. Rejected before any DB write.
    const effectiveStartDate = detailFields.startDate ?? loan.startDate;
    if (asOfDate < effectiveStartDate) {
      throw new ValidationError({ message: t({ key: 'loans.correctionAsOfBeforeStartDate' }) });
    }

    anchorInitialBalance = currentBalance.negate();

    // Re-anchoring changes which payment legs count as post-anchor, so the
    // asserted balance must leave room for every leg dated on/after the new
    // as-of date — otherwise `recomputeLoanBalance` would push the outstanding
    // past zero into credit and stamp a bogus `paid_off` event. Projected
    // exactly zero is allowed (a legit backdated payoff). Rejected before any
    // DB write.
    const postAnchorPaymentsTotal = await sumPostAnchorPaymentLegs({
      loanAccountId: accountId,
      userId,
      anchorDate: asOfDate,
    });
    const { projectedBalance, overpaysBy } = projectLoanOverpay({
      projectedBalance: anchorInitialBalance.add(postAnchorPaymentsTotal),
    });
    if (overpaysBy.toCents() > 0) {
      throw new ValidationError({
        message: t({
          key: 'loans.correctionOverpay',
          variables: {
            overpayAmount: projectedBalance.toNumber(),
            paymentsTotal: postAnchorPaymentsTotal.toNumber(),
            asOfDate,
          },
        }),
      });
    }

    anchorRefInitialBalance = await calculateRefAmount({
      userId,
      amount: anchorInitialBalance,
      baseCode: loan.account.currencyCode,
      date: now,
    });
    detailUpdates.balanceAnchorDate = asOfDate;
    // Manual balance edits leave no transaction trail — this timeline event is
    // the only record of the correction.
    newEvents.push({
      type: 'balance_correction',
      at: now.toISOString(),
      fromCents: loan.account.currentBalance.abs().toNumber(),
      toCents: currentBalance.toNumber(),
    });
  }

  if (newEvents.length > 0) {
    detailUpdates.events = [...(loan.events ?? []), ...newEvents];
  }

  // Persist the sidecar (including the moved anchor date) first: the recompute
  // below reads `balanceAnchorDate` to decide which payment legs are post-anchor.
  if (Object.keys(detailUpdates).length > 0) {
    await loan.update(detailUpdates);
  }

  // Name routes through the canonical account-update path; the balance write is
  // separate because a correction sets the anchor directly (see below).
  if (name !== undefined) {
    await updateAccount({ id: accountId, userId, name });
  }

  if (anchorInitialBalance !== null && anchorRefInitialBalance !== null) {
    // Set the anchor balance directly — `updateAccount` shifts initialBalance by
    // the balance diff, which would defeat re-anchoring.
    await Accounts.update(
      { initialBalance: anchorInitialBalance, refInitialBalance: anchorRefInitialBalance },
      { where: { id: accountId, userId } },
    );

    // Recompute last — it reads both the persisted balanceAnchorDate (LoanDetails)
    // and initialBalance (Accounts) to derive the authoritative currentBalance.
    await recomputeLoanBalance({ loanAccountId: accountId, userId });
  }

  return loan.reload({ include: [{ model: Accounts, as: 'account' }] });
};

export const updateLoan = withTransaction(updateLoanImpl);
