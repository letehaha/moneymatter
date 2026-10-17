import { ACCOUNT_CATEGORIES, TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { logger } from '@js/utils/logger';
import Accounts from '@models/accounts.model';

import { withTransaction } from '../common/with-transaction';
import { lockAccountRow } from './lock-account-row';

/**
 * Account balance recalculation triggered by Sequelize hooks on `Transactions`.
 * Kept out of `services/accounts.service.ts`: that service imports the share-aware
 * account lookups, which transitively import models, and pulling those in from
 * `transactions.model.ts` forms a circular import cycle ts-node hits at startup
 * (`models.map(m => m.prototype)` crashes on an undefined entry). This file imports
 * only the `Accounts` model and shared utilities, so transactions.model can require
 * it without re-entering the model loader.
 */

const calculateNewBalance = ({
  amount,
  previousAmount,
  currentBalance,
}: {
  amount: Money;
  previousAmount: Money;
  currentBalance: Money;
}): Money => {
  return currentBalance.add(amount.subtract(previousAmount));
};

const defineCorrectAmountFromTxType = ({
  amount,
  transactionType,
}: {
  amount: Money;
  transactionType: TRANSACTION_TYPES;
}): Money => {
  return transactionType === TRANSACTION_TYPES.income ? amount : amount.negate();
};

async function updateAccountBalanceForChangedTxImpl({
  accountId,
  transactionType,
  amount = Money.zero(),
  prevAmount = Money.zero(),
  prevTransactionType = transactionType,
  removedTransactionId,
}: {
  accountId: string;
  transactionType: TRANSACTION_TYPES;
  amount?: Money;
  prevAmount?: Money;
  prevTransactionType?: TRANSACTION_TYPES;
  /**
   * Set by the BeforeDestroy hook: the row being removed still exists then, so the
   * ledger-boundary lookup must exclude it explicitly.
   */
  removedTransactionId?: string;
}): Promise<void> {
  // Account-scoped, not user-scoped: the service layer has already authorized the
  // write (owner or recipient with `write`/`manage`), so the balance update runs
  // against the account regardless of who authored the transaction. A `userId`
  // filter would drop recipient-authored updates and drift `currentBalance`.
  //
  // `noKey`: the transaction row inserted just before this hook already references
  // the account, so FOR UPDATE would deadlock two concurrent inserts.
  const account = await lockAccountRow({ accountId, noKey: true });

  if (!account) {
    // Hook runs after the tx row committed. A missing account means the balance
    // silently drifts, so report it instead of a fire-and-forget no-op.
    logger.error(
      {
        message: 'Account missing when applying balance update for changed transaction',
        error: new Error(`Accounts.findOne returned null for accountId=${accountId}`),
      },
      {
        code: 'ACCOUNT_BALANCE_UPDATE_MISSING_ACCOUNT',
        accountId,
      },
    );
    return undefined;
  }

  // Loan balances are recomputed from the anchor snapshot by recomputeLoanBalance,
  // never deltad here — a delta would double-apply and ignore the anchor boundary.
  if (account.accountCategory === ACCOUNT_CATEGORIES.loan) return undefined;

  const newAmount = defineCorrectAmountFromTxType({ amount, transactionType });
  const oldAmount = defineCorrectAmountFromTxType({ amount: prevAmount, transactionType: prevTransactionType });

  const newCurrentBalance = calculateNewBalance({
    amount: newAmount,
    previousAmount: oldAmount,
    currentBalance: account.currentBalance,
  });

  // `refCurrentBalance` is a spot measure (native balance × latest rate), not a
  // running sum of per-transaction `refAmount`s — those carry historical rates and
  // would leave a ref residue on an account drained back to zero.
  //
  // `measureSpotRefBalance` returns `undefined` when no rate reaches the pair; the stored
  // ref balance is kept (the daily remeasure self-heals it) so a delete never
  // fails. It returns `null` for a custom currency without a rate, which is stored as
  // such. Dynamic import for the module-comment reason: it statically pulls in the
  // exchange-rate stack, which must not load while transactions.model is still in
  // the model loader.
  const { measureSpotRefBalance } = await import('./measure-spot-ref-balance');
  const measuredRefBalance = await measureSpotRefBalance({
    // Owner of the account, not the tx author — ref balances live in the owner's
    // base currency (shared accounts can be written by recipients).
    userId: account.userId,
    amount: newCurrentBalance,
    baseCode: account.currencyCode,
    site: 'updateAccountBalanceForChangedTx',
  });
  const refCurrentBalance = measuredRefBalance === undefined ? account.refCurrentBalance : measuredRefBalance;

  await Accounts.update({ currentBalance: newCurrentBalance, refCurrentBalance }, { where: { id: accountId } });

  // A changed transaction can move the account's ledger boundary (its earliest
  // transaction date), and `refInitialBalance` is stamped at the boundary's rate.
  const { restampRefInitialBalance } = await import('./restamp-ref-initial-balance');
  await restampRefInitialBalance({ accountId, excludeTransactionId: removedTransactionId });
}

export const updateAccountBalanceForChangedTx = withTransaction(updateAccountBalanceForChangedTxImpl);
