import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { logger } from '@js/utils/logger';
import Accounts from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import Users from '@models/users.model';
import { withTransaction } from '@root/services/common/with-transaction';
import { removePortfolioTransfersForAccounts } from '@services/accounts/remove-portfolio-transfers-for-accounts';
import { unlinkAccountFromBankConnection } from '@services/accounts/unlink-from-bank-connection';
import {
  AccountShareCleanupResult,
  cleanupAccountSharesInTx,
  notifyAccountDeleteRecipients,
} from '@services/sharing/cleanup/cleanup-account-shares.service';
import { pauseAutomationsReferencing } from '@services/transaction-automations/references';
import { unlinkPaymentLegsOfAccounts } from '@services/transactions/payment-legs';

import { bankProviderRegistry } from '../registry';

interface DisconnectProviderInTxResult {
  /** One entry per destroyed account that had shares (per-resource or household) — fed
   *  to the post-commit fan-out so recipients learn about the cascade. Empty when
   *  `removeAssociatedAccounts === false` or none of the destroyed accounts were shared. */
  cleanups: Array<{
    account: { id: string; name: string };
    recipients: AccountShareCleanupResult['recipients'];
    householdRecipients: AccountShareCleanupResult['householdRecipients'];
  }>;
}

const disconnectProviderInTx = withTransaction(
  async ({
    connectionId,
    userId,
    removeAssociatedAccounts = false,
  }: {
    connectionId: string;
    userId: number;
    removeAssociatedAccounts?: boolean;
  }): Promise<DisconnectProviderInTxResult> => {
    const connection = await findOrThrowNotFound({
      query: BankDataProviderConnections.findOne({
        where: {
          id: connectionId,
          userId,
        },
      }),
      message: t({ key: 'errors.connectionNotFound' }),
    });

    const linkedAccounts = await Accounts.findAll({
      where: {
        userId,
        bankDataProviderConnectionId: connectionId,
      },
    });

    const cleanups: DisconnectProviderInTxResult['cleanups'] = [];

    if (removeAssociatedAccounts) {
      // Bulk `Accounts.destroy` below skips per-instance hooks AND bypasses the
      // account-delete service that normally runs share cleanup. Walk each account
      // through `cleanupAccountSharesInTx` first so any `ResourceShares` rows and
      // pending invitations get the same in-tx pruning + post-commit notification
      // treatment as a direct `DELETE /accounts/:id`.
      for (const account of linkedAccounts) {
        // The bulk destroy below bypasses `deleteAccountByIdInTx`, so `account` refs
        // would otherwise survive the cascade unpaused.
        await pauseAutomationsReferencing({ userId, refType: 'account', refId: account.id, label: account.name });

        const cleanup = await cleanupAccountSharesInTx({ accountId: account.id, ownerUserId: userId });
        if (cleanup.recipients.length > 0 || cleanup.householdRecipients.length > 0) {
          cleanups.push({
            account: { id: account.id, name: account.name },
            recipients: cleanup.recipients,
            householdRecipients: cleanup.householdRecipients,
          });
        }
      }

      await removePortfolioTransfersForAccounts({ userId, accountIds: linkedAccounts.map((account) => account.id) });
      await unlinkPaymentLegsOfAccounts({ userId, accountIds: linkedAccounts.map((account) => account.id) });

      await Accounts.destroy({
        where: {
          userId,
          bankDataProviderConnectionId: connectionId,
        },
      });
    } else {
      // Reset each account to system type, preserving connection history
      // and transaction original IDs (same as individual account unlink). Shares
      // survive the unlink — the account row sticks around, just stops being
      // bank-managed.
      for (const account of linkedAccounts) {
        await unlinkAccountFromBankConnection({ accountId: account.id, userId });
      }
    }

    await pauseAutomationsReferencing({
      userId,
      refType: 'bankConnection',
      refId: connection.id,
      label: connection.providerName,
    });

    const provider = bankProviderRegistry.get(connection.providerType as BANK_PROVIDER_TYPE);
    await provider.disconnect(connectionId);

    return { cleanups };
  },
);

/**
 * Disconnects a bank-data-provider connection. The in-tx phase commits the destroy /
 * unlink work atomically; share-recipient notifications fire post-commit so a transient
 * notification failure can't re-open a destroyed account.
 */
export const disconnectProvider = async (params: {
  connectionId: string;
  userId: number;
  removeAssociatedAccounts?: boolean;
}): Promise<void> => {
  const result = await disconnectProviderInTx(params);

  if (result.cleanups.length === 0) return;

  // Single owner fetch for the whole batch — every cleanup belongs to the same user.
  const owner = await Users.findByPk(params.userId);
  // Notification failures must not bubble up as a 500: the accounts are already destroyed
  // and the connection is unwound. Each `notifyAccountDeleteRecipients` already wraps its
  // per-recipient loop in try/catch, but a top-level throw (e.g. before the loop starts)
  // would otherwise reject the whole `Promise.all` and surface to the user.
  try {
    await Promise.all(
      result.cleanups.map((entry) =>
        notifyAccountDeleteRecipients({
          recipients: entry.recipients,
          householdRecipients: entry.householdRecipients,
          owner,
          account: entry.account,
        }),
      ),
    );
  } catch (error) {
    logger.error(
      {
        message: 'Failed to fan out share-recipient notifications after provider disconnect',
        error: error as Error,
      },
      {
        code: 'DISCONNECT_PROVIDER_NOTIFY_FAILED',
        userId: params.userId,
        cleanupCount: result.cleanups.length,
      },
    );
  }
};
