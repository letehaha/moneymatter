import { ACCOUNT_TYPES } from '@bt/shared/types';
import { NotFoundError, ValidationError } from '@js/errors';
import Accounts from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { connection } from '@models/connection';
import { findTransactions, updateTransactions } from '@models/transactions-query';
import { runPendingLinkAbsorb } from '@services/accounts/absorb-link-residual';
import { lockAccountRow } from '@services/accounts/lock-account-row';
import { getSeamStart } from '@services/accounts/seam';
import { clearSeam } from '@services/balances/revalue-balance-history.service';
import { withTransaction } from '@services/common/with-transaction';
import { assertNoUnfinishedImport } from '@services/import-export/core/unfinished-import';
import { Sequelize } from 'sequelize';

interface UnlinkAccountFromBankConnectionPayload {
  accountId: string;
  userId: number;
}

/**
 * Under a seam every live import row sits in the opening balance. Restating each batch's
 * effect as −Σ its live rows lets an undo after unlink leave `currentBalance` where the bank left it.
 */
const restateImportEffectsAtSeam = async ({ accountId }: { accountId: string }) => {
  await connection.sequelize.query(
    `UPDATE "ImportBatchAccountEffects" SET "absorbedAmount" = 0 WHERE "accountId" = :accountId`,
    {
      replacements: { accountId },
    },
  );
  await connection.sequelize.query(
    `INSERT INTO "ImportBatchAccountEffects" ("importBatchId", "accountId", "absorbedAmount", "createdByImport")
     SELECT b."id", t."accountId",
            -SUM(CASE WHEN t."transactionType" = 'income' THEN t."amount" ELSE -t."amount" END), false
       FROM real_transactions t
       JOIN "ImportBatches" b
         ON b."userId" = t."userId"
        AND lower(b."batchId"::text) = lower(t."externalData"->'importDetails'->>'batchId')
      WHERE t."accountId" = :accountId
      GROUP BY b."id", t."accountId"
     ON CONFLICT ("importBatchId", "accountId") DO UPDATE SET "absorbedAmount" = EXCLUDED."absorbedAmount"`,
    { replacements: { accountId } },
  );
};

/**
 * Converts a bank-linked account back to a manual one: settles a pending link absorb, rebuilds
 * the history before the link day and drops S, then retypes the account and its rows to `system`,
 * recording the previous connection and each synced row's original id.
 */
export const unlinkAccountFromBankConnection = withTransaction(
  async ({ accountId, userId }: UnlinkAccountFromBankConnectionPayload) => {
    // Locked: a deferred link absorb committing mid-unlink would stamp a seam this read misses.
    let account = await lockAccountRow({ accountId, userId, noKey: true });

    if (!account) {
      throw new NotFoundError({
        message: `Account with id "${accountId}" not found.`,
      });
    }

    // Verify account is actually connected to a bank
    if (!account.bankDataProviderConnectionId) {
      throw new ValidationError({
        message: 'Account is not linked to any bank connection.',
      });
    }

    await assertNoUnfinishedImport({ userId });

    // Get the bank connection details before unlinking
    const bankConnection = await BankDataProviderConnections.findByPk(account.bankDataProviderConnectionId);

    // A link whose queued first sync never settled its absorb settles it now, while the account
    // is still bank-typed, so the seam branch below rebuilds the history before the link day.
    if (account.externalData?.bankConnection?.balanceReconciliation?.pendingAbsorb && !getSeamStart({ account })) {
      await runPendingLinkAbsorb({ accountId, userId });
      account = (await lockAccountRow({ accountId, userId, noKey: true }))!;
    }

    // Prepare connection history for account's externalData
    const existingExternalData = account.externalData ?? {};
    const updatedAccountExternalData = {
      ...existingExternalData,
      connectionHistory: {
        lastDisconnectedAt: new Date().toISOString(),
        previousConnection: {
          type: account.type,
          externalId: account.externalId,
          bankDataProviderConnectionId: account.bankDataProviderConnectionId,
          providerType: bankConnection?.providerType || null,
        },
      },
    };

    // Read before the account turns `system`. Provider-type strings equal
    // account-type strings, so the account type stands in for a missing connection row.
    const importedFrom = bankConnection?.providerType || account.type;

    // Before the retype: a `system` account may not hold S.
    if (account.seamBalance != null) {
      if (getSeamStart({ account })) await restateImportEffectsAtSeam({ accountId });
      await clearSeam({ accountId });
    }

    // Update the account: convert to system type and clear bank-related fields
    await account.update({
      type: ACCOUNT_TYPES.system,
      bankDataProviderConnectionId: null,
      externalId: null,
      externalData: updatedAccountExternalData,
    });

    // Capture each transaction's original bank metadata (originalId + accountType)
    // BEFORE the bulk wipe below, so the per-row externalData snapshot still has
    // the pre-unlink values to record in `originalSource`.
    const transactions = await findTransactions({
      planned: 'include',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      completeness: 'all',
      where: { accountId },
      // Rows removed via reconciliation must convert too, or restore rejects them as still bank-typed.
      paranoid: false,
    });

    // Bulk-flip every transaction to `system` in a single SQL UPDATE. We
    // deliberately skip Sequelize hooks: the `@AfterUpdate` hook on Transactions
    // recomputes the account's `currentBalance` and rewrites the historical
    // `Balances` rows for every transaction that fires it. Unlink does NOT touch
    // any balance-relevant field (`amount` / `refAmount` / `transactionType` /
    // `time` are unchanged) — every recomputation is a no-op delta but still
    // runs a `findOne` + `update` per row, serialised on one PG connection.
    // For an account with N transactions that turns into O(N) wasted DB ops
    // (~5/tx) and pushed real-world unlinks past 80 seconds for ~350 rows.
    // A static bulk update skips instance hooks by default, but `hooks: false`
    // makes the intent explicit and also blocks any future `@BeforeBulkUpdate`
    // hook from sneaking back in.
    // Never null `originalId` on file-imported rows (`importDetails`):
    // re-importing the same file would duplicate them.
    await updateTransactions({
      planned: 'include',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      values: {
        accountType: ACCOUNT_TYPES.system,
        originalId: Sequelize.literal(
          `CASE WHEN "externalData"->'importDetails' IS NULL THEN NULL ELSE "originalId" END`,
        ),
      },
      where: { accountId },
      paranoid: false,
      hooks: false,
    });

    // Only bank-synced rows get an `originalSource` snapshot. File-imported rows
    // (`importDetails`) also carry an `originalId` and get none.
    for (const transaction of transactions) {
      if (!transaction.originalId) continue;

      const existingTxExternalData = transaction.externalData || {};
      if ('importDetails' in existingTxExternalData) continue;

      const updatedTxExternalData = {
        ...existingTxExternalData,
        originalSource: {
          originalId: transaction.originalId,
          importedFrom,
          accountType: transaction.accountType,
        },
      };

      await updateTransactions({
        planned: 'include',
        access: 'unscoped-internal',
        balanceAdjustments: 'include',
        values: { externalData: updatedTxExternalData },
        where: { id: transaction.id },
        paranoid: false,
        hooks: false,
      });
    }

    // Fetch and return the updated account
    const updatedAccount = await Accounts.findByPk(accountId);
    return updatedAccount;
  },
);
