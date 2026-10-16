import { type AccountExternalData, type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { UnexpectedError } from '@js/errors';
import { logger } from '@js/utils/logger';
import Accounts from '@models/accounts.model';
import Balances from '@models/balances.model';
import { namespace } from '@models/connection';
import Transactions from '@models/transactions.model';
import { createBalanceAdjustmentTransaction } from '@services/accounts/balance-adjustment';
import { lockAccountRow } from '@services/accounts/lock-account-row';
import { restampRefInitialBalance } from '@services/accounts/restamp-ref-initial-balance';
import { writeBankBalanceWithHistory } from '@services/bank-data-providers/utils/write-bank-balance-with-history';
import { withTransaction } from '@services/common/with-transaction';
import { QueryTypes } from 'sequelize';

type LinkResidualOutcome = { absorbedResidual?: number; adjustmentTransactionId?: RecordId };

/**
 * Restores `initialBalance + Σsigned(tx) = currentBalance` after a post-link
 * sync force-wrote the bank balance. The bank owns `currentBalance`, so the
 * residual goes where the link's `residualTarget` says: into the opening
 * balance (the default), or into one balance-adjustment row dated at the link.
 */
export const absorbLinkResidual = withTransaction(
  async ({ accountId, userId }: { accountId: string; userId: number }): Promise<LinkResidualOutcome> => {
    const sequelizeTx = namespace.get('transaction');

    // Lock before summing: a concurrent sync blocks on this row lock, so summing
    // first would pair a pre-sync ledger sum with a post-sync currentBalance and
    // absorb the concurrent delta into the opening balance.
    const account = await lockAccountRow({ accountId, userId });
    if (!account) {
      logger.error(
        {
          message: 'Account missing when absorbing the post-link balance residual',
          error: new Error(`Accounts.findOne returned null for accountId=${accountId}`),
        },
        { code: 'ACCOUNT_LINK_RESIDUAL_ACCOUNT_MISSED', accountId, userId },
      );
      return {};
    }

    // Every row that moved the balance counts, adjustments included; `real_transactions`
    // drops the planned rows, which by definition moved nothing.
    const [row] = await Transactions.sequelize!.query<{ signedSum: string }>(
      `SELECT COALESCE(SUM(CASE WHEN "transactionType" = :incomeType THEN "amount" ELSE -"amount" END), 0) AS "signedSum"
       FROM real_transactions WHERE "accountId" = :accountId`,
      {
        replacements: { accountId, incomeType: TRANSACTION_TYPES.income },
        type: QueryTypes.SELECT,
        transaction: sequelizeTx,
      },
    );

    const signedSumCents = Money.fromDecimal(row?.signedSum ?? 0).toCents();
    const initialBalanceBefore = account.initialBalance;
    const identityGapCents = account.currentBalance.toCents() - (initialBalanceBefore.toCents() + signedSumCents);
    if (identityGapCents === 0) return {};

    const bankConnection = account.externalData?.bankConnection;
    const residualTarget = bankConnection?.balanceReconciliation.residualTarget;
    if (bankConnection && residualTarget === 'adjustment') {
      const bankBalance = account.currentBalance;
      const adjustment = await createBalanceAdjustmentTransaction({
        userId,
        accountId,
        amountDelta: Money.fromCents(identityGapCents),
        time: new Date(bankConnection.linkedAt),
      });

      // The adjustment row's hooks moved currentBalance and today's Balances row off
      // the bank figure. Reload first so the pin-back update is not a no-op diff.
      await account.reload({ transaction: sequelizeTx });
      await writeBankBalanceWithHistory({ account, balance: bankBalance });

      logger.info('Recorded post-link balance residual as a balance adjustment', {
        accountId,
        userId,
        signedSumCents,
        identityGapCents,
        residualTarget,
        adjustmentTransactionId: adjustment.id,
      });

      return { adjustmentTransactionId: adjustment.id };
    }

    const initialBalanceAfter = initialBalanceBefore.add(Money.fromCents(identityGapCents));
    await Accounts.update({ initialBalance: initialBalanceAfter }, { where: { id: accountId, userId } });

    // A failed restamp would pair the moved opening balance with a stale
    // base-currency stamp; throw so the whole absorb rolls back.
    const restampOutcome = await restampRefInitialBalance({ accountId, allowProviderAccount: true });
    if (restampOutcome === 'failed') {
      throw new UnexpectedError({
        message:
          'Failed to restate the opening balance in the base currency; the link was not applied. Please try again.',
      });
    }

    // The restamp cascade shifts every Balances row, including today's, which the
    // sync pinned to the bank's authoritative balance. Re-pin it from the
    // post-restamp row.
    const restamped = await Accounts.findOne({ where: { id: accountId, userId }, transaction: sequelizeTx });
    if (restamped) {
      await Balances.setTodayRowToSpot({ account: restamped });
    } else {
      logger.error(
        {
          message: 'Account re-read after restampRefInitialBalance missed; the current-day balance row stays cascaded',
          error: new Error(`Accounts.findOne returned null for accountId=${accountId}`),
        },
        { code: 'ACCOUNT_LINK_RESIDUAL_REREAD_MISSED', accountId, userId },
      );
    }

    logger.info('Absorbed post-link balance residual into the opening balance', {
      accountId,
      userId,
      signedSumCents,
      identityGapCents,
      residualTarget,
      initialBalanceBeforeCents: initialBalanceBefore.toCents(),
      initialBalanceAfterCents: initialBalanceAfter.toCents(),
    });

    return { absorbedResidual: identityGapCents };
  },
);

/**
 * Runs the absorb that linking deferred via `pendingAbsorb` (queue-synced
 * providers persist nothing inline, so no residual exists until the worker
 * finishes) and records the outcome in the reconciliation snapshot. Without
 * the marker it no-ops returning null, so it is safe after every sync group.
 */
export const runPendingLinkAbsorb = withTransaction(
  async ({ accountId, userId }: { accountId: string; userId: number }): Promise<LinkResidualOutcome | null> => {
    const account = await Accounts.findOne({ where: { id: accountId, userId } });
    const externalData = (account?.externalData ?? {}) as AccountExternalData;
    const reconciliation = externalData.bankConnection?.balanceReconciliation;

    if (!account || !reconciliation?.pendingAbsorb) return null;

    const outcome = await absorbLinkResidual({ accountId, userId });

    // Re-read: the absorb rewrote the account behind this instance.
    const fresh = await Accounts.findOne({ where: { id: accountId, userId } });
    if (!fresh) return outcome;

    const freshExternalData = (fresh.externalData ?? {}) as AccountExternalData;
    const freshConnectionMeta = freshExternalData.bankConnection;
    if (!freshConnectionMeta) return outcome;

    await fresh.update({
      externalData: {
        ...freshExternalData,
        bankConnection: {
          ...freshConnectionMeta,
          balanceReconciliation: {
            ...freshConnectionMeta.balanceReconciliation,
            pendingAbsorb: false,
            ...outcome,
          },
        },
      },
    });

    return outcome;
  },
);
