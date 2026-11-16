import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { logger } from '@js/utils/logger';
import Accounts from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import Users from '@models/users.model';
import { withTransaction } from '@root/services/common/with-transaction';
import { deleteAccountByIdInTx } from '@services/accounts.service';
import { unlinkAccountFromBankConnection } from '@services/accounts/unlink-from-bank-connection';
import {
  AccountShareCleanupResult,
  notifyAccountDeleteRecipients,
} from '@services/sharing/cleanup/cleanup-account-shares.service';
import { pauseAutomationsReferencing } from '@services/transaction-automations/references';

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
      // UUIDv7 ids sort by creation time.
      order: [['id', 'ASC']],
    });

    const cleanups: DisconnectProviderInTxResult['cleanups'] = [];

    if (removeAssociatedAccounts) {
      for (const account of linkedAccounts) {
        const { cleanup, accountSnapshot } = await deleteAccountByIdInTx({
          id: account.id,
          userId,
          removePortfolioTransfers: true,
        });
        if (cleanup.recipients.length > 0 || cleanup.householdRecipients.length > 0) {
          cleanups.push({
            account: accountSnapshot,
            recipients: cleanup.recipients,
            householdRecipients: cleanup.householdRecipients,
          });
        }
      }
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

  // Notification failures must not bubble up as a 500: the accounts are already destroyed
  // and the connection is unwound. Each `notifyAccountDeleteRecipients` already wraps its
  // per-recipient loop in try/catch, but a top-level throw (e.g. before the loop starts)
  // would otherwise reject the whole `Promise.all` and surface to the user.
  try {
    const owner = await Users.findByPk(params.userId);
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
