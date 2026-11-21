import { type AccountExternalData, type LinkResidualTarget, TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { ExchangeRateUnavailableError } from '@js/errors';
import { logger } from '@js/utils/logger';
import Accounts from '@models/accounts.model';
import Balances from '@models/balances.model';
import { namespace } from '@models/connection';
import Transactions from '@models/transactions.model';
import { createBalanceAdjustmentTransaction } from '@services/accounts/balance-adjustment';
import { isLinkedToBank, lockAccountRow } from '@services/accounts/lock-account-row';
import { restampRefInitialBalance } from '@services/accounts/restamp-ref-initial-balance';
import { stampSeamBalance } from '@services/balances/revalue-balance-history.service';
import { writeBankBalanceWithHistory } from '@services/bank-data-providers/utils/write-bank-balance-with-history';
import { runInSavepoint } from '@services/common/run-in-savepoint';
import { withTransaction } from '@services/common/with-transaction';
import { QueryTypes } from 'sequelize';

type BalanceReconciliation = NonNullable<AccountExternalData['bankConnection']>['balanceReconciliation'];
type LinkResidualOutcome = Partial<Pick<BalanceReconciliation, 'absorbedResidual' | 'adjustmentTransactionId'>>;

/**
 * Every row that moved the balance counts, adjustments included; `real_transactions`
 * drops the planned rows, which by definition moved nothing.
 */
const sumSignedRealRows = async ({ accountId }: { accountId: string }): Promise<Money> => {
  const [row] = await Transactions.sequelize!.query<{ signedSum: string }>(
    `SELECT COALESCE(SUM(CASE WHEN "transactionType" = :incomeType THEN "amount" ELSE -"amount" END), 0) AS "signedSum"
     FROM real_transactions WHERE "accountId" = :accountId`,
    {
      replacements: { accountId, incomeType: TRANSACTION_TYPES.income },
      type: QueryTypes.SELECT,
      transaction: namespace.get('transaction'),
    },
  );
  return Money.fromDecimal(row?.signedSum ?? 0);
};

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
    const account = await lockAccountRow({ accountId, userId, noKey: true });
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

    const signedSum = await sumSignedRealRows({ accountId });
    const initialBalanceBefore = account.initialBalance;
    const identityGap = account.currentBalance.subtract(initialBalanceBefore.add(signedSum));
    if (identityGap.isZero()) return {};

    const bankConnection = account.externalData?.bankConnection;
    const residualTarget = bankConnection?.balanceReconciliation.residualTarget;
    if (bankConnection && residualTarget === 'adjustment') {
      const bankBalance = account.currentBalance;
      const adjustment = await createBalanceAdjustmentTransaction({
        userId,
        accountId,
        amountDelta: identityGap,
        time: new Date(bankConnection.linkedAt),
      });

      // The adjustment row's hooks moved currentBalance and today's Balances row off
      // the bank figure. Reload first so the pin-back update is not a no-op diff.
      await account.reload({ transaction: sequelizeTx });
      await writeBankBalanceWithHistory({ account, balance: bankBalance });

      logger.info('Recorded post-link balance residual as a balance adjustment', {
        accountId,
        userId,
        signedSum: signedSum.toNumber(),
        identityGap: identityGap.toNumber(),
        residualTarget,
        adjustmentTransactionId: adjustment.id,
      });

      return { adjustmentTransactionId: adjustment.id };
    }

    const initialBalanceAfter = initialBalanceBefore.add(identityGap);
    await Accounts.update({ initialBalance: initialBalanceAfter }, { where: { id: accountId, userId } });

    // A failed restamp would pair the moved opening balance with a stale
    // base-currency stamp; throw so the whole absorb rolls back.
    const restampOutcome = await restampRefInitialBalance({ accountId, allowProviderAccount: true });
    if (restampOutcome === 'failed') {
      throw new ExchangeRateUnavailableError({
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
      signedSum: signedSum.toNumber(),
      identityGap: identityGap.toNumber(),
      residualTarget,
      initialBalanceBefore: initialBalanceBefore.toNumber(),
      initialBalanceAfter: initialBalanceAfter.toNumber(),
    });

    return { absorbedResidual: identityGap.toNumber() };
  },
);

const hasPendingAbsorb = ({ row }: { row: Accounts | null }): boolean =>
  !!row?.externalData?.bankConnection?.balanceReconciliation?.pendingAbsorb;

/**
 * Moves only the native opening balance so `initialBalance + Σ signed real rows = currentBalance`.
 * The base-currency stamp stays as it was; the nightly sweep restates it once a rate exists.
 */
const absorbIntoNativeOpeningBalance = async ({
  accountId,
  userId,
}: {
  accountId: string;
  userId: number;
}): Promise<LinkResidualOutcome> => {
  const account = await lockAccountRow({ accountId, userId, noKey: true });
  if (!account) return {};

  const gap = account.currentBalance.subtract(account.initialBalance.add(await sumSignedRealRows({ accountId })));
  if (gap.isZero()) return {};

  await Accounts.update({ initialBalance: account.initialBalance.add(gap) }, { where: { id: accountId, userId } });
  return { absorbedResidual: gap.toNumber() };
};

/**
 * `absorbLinkResidual`, except that without an exchange rate it moves only the native opening balance,
 * also when the link asked for an adjustment row, which the log names.
 */
export const absorbLinkResidualWithRateFallback = async ({
  accountId,
  userId,
  residualTarget,
}: {
  accountId: string;
  userId: number;
  residualTarget: LinkResidualTarget | undefined;
}): Promise<LinkResidualOutcome> => {
  try {
    return await runInSavepoint(() => absorbLinkResidual({ accountId, userId }));
  } catch (error) {
    if (!(error instanceof ExchangeRateUnavailableError)) throw error;
    logger.error(
      { message: 'Link absorb had no exchange rate; moved only the native opening balance', error },
      { code: 'LINK_ABSORB_RATE_FALLBACK', accountId, userId, requestedResidualTarget: residualTarget },
    );
    return absorbIntoNativeOpeningBalance({ accountId, userId });
  }
};

/**
 * Runs the absorb linking deferred via `pendingAbsorb`, stamps S and clears the marker; a no-op
 * returning null without the marker. Without a rate only the native opening balance moves; any
 * other failure propagates to the caller's transaction.
 */
export const runPendingLinkAbsorb = withTransaction(
  async ({ accountId, userId }: { accountId: string; userId: number }): Promise<LinkResidualOutcome | null> => {
    // Every sync calls this, so the row lock is taken only once the marker is seen.
    if (!hasPendingAbsorb({ row: await Accounts.findOne({ where: { id: accountId, userId } }) })) return null;

    // Locked so an unlink racing the queued sync either commits first and is seen here, or waits.
    const account = await lockAccountRow({ accountId, userId, noKey: true });
    if (!hasPendingAbsorb({ row: account }) || !isLinkedToBank({ account })) return null;

    const outcome = await absorbLinkResidualWithRateFallback({
      accountId,
      userId,
      residualTarget: account?.externalData?.bankConnection?.balanceReconciliation?.residualTarget,
    });
    await stampSeamBalance({ accountId });

    // Re-read: the absorb rewrote the account behind this instance.
    const fresh = await Accounts.findOne({ where: { id: accountId, userId } });
    const freshExternalData = fresh?.externalData ?? {};
    const freshConnectionMeta = freshExternalData.bankConnection;
    if (!fresh || !freshConnectionMeta) return outcome;

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
