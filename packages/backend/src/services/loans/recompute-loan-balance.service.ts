import { ACCOUNT_CATEGORIES, type LoanEvent } from '@bt/shared/types';
import { getBaseCurrencyDecimals, getCurrencyDecimals } from '@common/lib/currency-precision';
import { Money, moneyEqualsOrNull } from '@common/types/money';
import { logger } from '@js/utils/logger';
import Accounts from '@models/accounts.model';
import Balances from '@models/balances.model';
import LoanDetails from '@models/loan-details.model';
import type Transactions from '@models/transactions.model';
import { lockAccountRow } from '@services/accounts/lock-account-row';
import { measureSpotRefBalance } from '@services/accounts/measure-spot-ref-balance';
import { withTransaction } from '@services/common/with-transaction';
import { getPostAnchorPaymentLegs } from '@services/loans/get-post-anchor-payment-legs';
import { replayLoanOutstanding } from '@services/loans/replay-loan-outstanding';
import { Op } from 'sequelize';

/**
 * The moment a loan actually settled: replay the post-anchor payment legs in
 * date order on top of the anchor balance and return the `time` of the first
 * leg at which the cumulative balance reaches zero. An anchor balance already
 * at/above zero (a manual correction straight to zero, no settling leg) means
 * the loan settled on the anchor date itself. Falls back to the current time
 * only when neither source applies.
 */
const resolveSettledAt = ({
  anchorBalance,
  anchorDate,
  legs,
}: {
  anchorBalance: Money;
  /** yyyy-MM-dd anchor boundary. */
  anchorDate: string;
  legs: Transactions[];
}): string => {
  if (!anchorBalance.isNegative()) return new Date(anchorDate).toISOString();

  const sortedLegs = [...legs].toSorted((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  let cumulativeBalance = anchorBalance;
  for (const leg of sortedLegs) {
    cumulativeBalance = cumulativeBalance.add(leg.amount);
    if (!cumulativeBalance.isNegative()) return new Date(leg.time).toISOString();
  }
  return new Date().toISOString();
};

/**
 * Recompute a loan's authoritative balance from its anchor snapshot plus
 * `transfer_to_loan` legs dated on/after `balanceAnchorDate` — pre-anchor legs
 * are baked into the snapshot and stay informational. Loans are NOT maintained
 * incrementally like ordinary accounts. Idempotent; no-op for non-loan accounts.
 *
 * `userId` is optional because the Transactions model hooks that trigger this
 * don't carry it; all queries after the lookup are scoped by the account's own userId.
 */
const recomputeLoanBalanceImpl = async ({
  loanAccountId,
  userId,
}: {
  loanAccountId: string;
  userId?: number;
}): Promise<void> => {
  // SELECT ... FOR UPDATE on the loan account row: every payment write path
  // (create/edit/link/unlink) already locks this row via
  // `assertLoanPaymentAllowed` before projecting the balance, and this lock
  // re-acquires it within the same transaction (a no-op there). The payment
  // delete path reaches this recompute without going through the guard, so the
  // lock here is what keeps a concurrent payment write from reading a
  // pre-delete balance and jointly persisting a stale outstanding.
  const account = await lockAccountRow({ accountId: loanAccountId, userId });
  if (!account || account.accountCategory !== ACCOUNT_CATEGORIES.loan) return;

  const loanDetails = await LoanDetails.findOne({
    where: { accountId: loanAccountId, userId: account.userId },
  });
  if (!loanDetails) {
    // The account is a loan (guarded above) yet has no sidecar — a data-integrity
    // break. Report it instead of silently leaving the balance unmaintained.
    logger.error(
      {
        message: 'Loan account is missing its LoanDetails sidecar; balance left unrecomputed',
        error: new Error(`accountId=${loanAccountId}`),
      },
      { code: 'LOAN_RECOMPUTE_MISSING_DETAILS', loanAccountId },
    );
    return;
  }
  const anchorDate = loanDetails.balanceAnchorDate;

  // Only DATE(time) >= anchor adjusts the outstanding; the snapshot already
  // accounts for earlier payments.
  const legs = await getPostAnchorPaymentLegs({
    loanAccountId,
    userId: account.userId,
    anchorDate,
  });

  // The native legs are summed in minor units at the loan currency's decimals, the base-currency
  // (ref) legs at the base currency's, so neither side is ever rounded to cents.
  const [decimals, baseDecimals] = await Promise.all([
    getCurrencyDecimals({ userId: account.userId, code: account.currencyCode }),
    getBaseCurrencyDecimals({ userId: account.userId }),
  ]);

  // Income legs move a negative liability balance toward zero, so they add.
  let sumMinor = 0;
  for (const leg of legs) {
    sumMinor += leg.amount.toMinorUnits({ decimals });
  }

  // Loan balances are stored negative (liability); income legs add toward zero.
  // A batch that overshoots the owed amount would push the balance positive
  // (credit), but a loan never carries credit — the outstanding balance is
  // floored at zero and the excess stays only on the cash-account expense legs.
  const rawCurrentBalance = account.initialBalance.add(Money.fromMinorUnits({ value: sumMinor, decimals }));
  const newCurrentBalance = rawCurrentBalance.isPositive() ? Money.zero() : rawCurrentBalance;

  // The base-currency outstanding is a spot measure of the native outstanding — the
  // remaining liability at the latest rate — not the ref anchor plus historical-rate
  // payment legs (that blend leaves a residue after the native settles). Deriving
  // from the already-floored native balance keeps the two fields settling in
  // lockstep.
  //
  // A missing rate must not abort the recompute (a payment delete has to succeed):
  // keep the stored ref outstanding so the equals-guard skips the ref side, and let
  // the daily remeasure self-heal it once a rate exists.
  const newRefCurrentBalance =
    (await measureSpotRefBalance({
      userId: account.userId,
      amount: newCurrentBalance,
      baseCode: account.currencyCode,
      site: 'recomputeLoanBalance',
    })) ?? account.refCurrentBalance;

  if (
    !newCurrentBalance.equals(account.currentBalance) ||
    !moneyEqualsOrNull(newRefCurrentBalance, account.refCurrentBalance)
  ) {
    await Accounts.update(
      { currentBalance: newCurrentBalance, refCurrentBalance: newRefCurrentBalance },
      { where: { id: loanAccountId, userId: account.userId } },
    );
  }

  const events = loanDetails.events ?? [];

  // A settled→owing transition means the loan reopened (a payment edit/delete
  // pushed the balance back below zero) — the timeline must no longer claim the
  // loan is paid off, so every `paid_off` entry is dropped. Filtering ALL of
  // them (not just the last) also self-heals any duplicates already persisted.
  if (!account.currentBalance.isNegative() && newCurrentBalance.isNegative()) {
    const withoutPaidOff = events.filter((event) => event.type !== 'paid_off');
    if (withoutPaidOff.length !== events.length) {
      await loanDetails.update({ events: withoutPaidOff });
    }
  }

  // Stamp paid_off only on the owing→settled transition so repeated recomputes
  // don't duplicate it. `at` is the moment the loan actually settled — the date
  // of the payment leg that zeroed the balance (or the anchor date for a manual
  // correction to zero) — not the wall-clock time of this recompute, since
  // payments can be backdated or edited long after they landed.
  if (account.currentBalance.isNegative() && !newCurrentBalance.isNegative()) {
    const paidOffEvent: LoanEvent = {
      type: 'paid_off',
      at: resolveSettledAt({ anchorBalance: account.initialBalance, anchorDate, legs }),
    };
    await loanDetails.update({ events: [...events, paidOffEvent] });
  }

  // Rebuild the loan's Balances history off the base-currency (ref) anchor
  // snapshot: one row on the anchor date (same-day payments fold in — the anchor
  // boundary is inclusive) plus one cumulative row per later day with legs.
  // Balances rows are unique per (accountId, date). Loans opt out of the
  // per-transaction Balances cascade, so this rebuild is the loan's only history
  // writer; pre-anchor rows stay untouched. Balances.amount stores the ref balance.
  //
  // A parallel native replay over the same legs/anchor gives the outstanding in
  // the loan's own currency per day; both walks emit the same dates in the same
  // order because the day grouping and anchor-row logic depend only on the legs
  // and anchor, not on which amount each leg contributes.
  const nativeOutstandingByDate = new Map(
    replayLoanOutstanding({
      legs,
      anchorDate,
      openingBalance: account.initialBalance,
      decimals,
      pickMinor: ({ leg }) => leg.amount.toMinorUnits({ decimals }),
    }).map((row) => [row.date, row.balance]),
  );

  const rebuiltRows = replayLoanOutstanding({
    legs,
    anchorDate,
    openingBalance: account.refInitialBalance ?? Money.zero(),
    decimals: baseDecimals,
    pickMinor: ({ leg }) => leg.refAmount?.toMinorUnits({ decimals: baseDecimals }) ?? 0,
  }).map((row) => {
    // A day whose native outstanding is floored to zero is settled — nothing is
    // owed, so its base-currency row is zero too. The ref accumulator
    // (refInitialBalance stamped at the anchor rate plus each payment's refAmount
    // at its own historical rate) otherwise carries an FX residue once the native
    // balance reaches zero, splitting the net-worth chart from the spot account
    // card. `replayLoanOutstanding` already floors each row at zero, so a
    // non-negative native outstanding means the loan is settled on that day.
    const nativeOutstanding = nativeOutstandingByDate.get(row.date);
    const settled = nativeOutstanding !== undefined && !nativeOutstanding.isNegative();
    return { date: new Date(row.date), refBalance: settled ? Money.zero() : row.balance };
  });

  // Clear the range first so removed/moved payments leave no ghost rows; the
  // account-creation row falls inside it and is re-written by the anchor row.
  await Balances.destroy({
    where: { accountId: loanAccountId, date: { [Op.gte]: anchorDate } },
  });

  for (const row of rebuiltRows) {
    // Absolute upsert on (accountId, date) — race-safe against any concurrent
    // writer that lands between the cleanup above and this insert.
    await Balances.updateAccountBalance({
      accountId: loanAccountId,
      date: row.date,
      refBalance: row.refBalance,
    });
  }
};

export const recomputeLoanBalance = withTransaction(recomputeLoanBalanceImpl);
