import { ACCOUNT_TYPES } from '@bt/shared/types';
import { NotFoundError, ValidationError } from '@js/errors';
import Accounts, { getAccountById } from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { findTransactions, updateTransactions } from '@models/transactions-query';
import { withTransaction } from '@services/common/with-transaction';

interface UnlinkAccountFromBankConnectionPayload {
  accountId: string;
  userId: number;
}

/**
 * Unlinks an account from its bank connection and converts it to a system account.
 * This operation:
 * 1. Converts the account type to 'system'
 * 2. Stores connection history in account's externalData
 * 3. Updates all transactions to 'system' type and stores their original IDs in externalData
 * 4. Clears the bankDataProviderConnectionId
 */
export const unlinkAccountFromBankConnection = withTransaction(
  async ({ accountId, userId }: UnlinkAccountFromBankConnectionPayload) => {
    // Fetch the account (owner-scoped: the where-clause can't match another user's row)
    const account = await getAccountById({ id: accountId, userId });

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

    // Get the bank connection details before unlinking
    const bankConnection = await BankDataProviderConnections.findByPk(account.bankDataProviderConnectionId);

    // Prepare connection history for account's externalData
    const existingExternalData = (account.externalData as Record<string, unknown>) || {};
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
    await updateTransactions({
      planned: 'include',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      values: { accountType: ACCOUNT_TYPES.system, originalId: null },
      where: { accountId },
      paranoid: false,
      hooks: false,
    });

    // Per-row `externalData` merge — JSONB shape differs per row (the
    // `originalSource` snapshot only applies to txs that came from the bank,
    // i.e. had an `originalId`). Still skip hooks for the same reason as above;
    // touches only one column, runs in milliseconds even for thousands of rows.
    for (const transaction of transactions) {
      if (!transaction.originalId) continue;

      const existingTxExternalData = (transaction.externalData as Record<string, unknown>) || {};
      const updatedTxExternalData = {
        ...existingTxExternalData,
        originalSource: {
          originalId: transaction.originalId,
          importedFrom: bankConnection?.providerType || null,
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
