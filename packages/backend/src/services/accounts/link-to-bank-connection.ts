import {
  ACCOUNT_TYPES,
  API_ERROR_CODES,
  type AccountExternalData,
  BANK_PROVIDER_TYPE,
  type LinkResidualTarget,
  type RecordId,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { NotFoundError, ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import AccountGrouping from '@models/accounts-groups/account-grouping.model';
import AccountGroup from '@models/accounts-groups/account-groups.model';
import Accounts, { getAccountById } from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { namespace } from '@models/connection';
import Subscriptions from '@models/subscriptions.model';
import { updateAccount } from '@services/accounts.service';
import { absorbLinkResidual } from '@services/accounts/absorb-link-residual';
import { assertNotDerivedBalanceAccount } from '@services/accounts/derived-balance-guard';
import {
  PROVIDER_TO_ACCOUNT_TYPE,
  restoreRelinkedTransactionsAccountType,
} from '@services/accounts/restore-relinked-transactions-account-type';
import { bankProviderRegistry } from '@services/bank-data-providers';
import { assertExternalAccountNotLinkedElsewhere } from '@services/bank-data-providers/connection/connect-selected-accounts';
import { syncTransactionsForAccount } from '@services/bank-data-providers/connection/sync-transactions-for-account';
import { SyncStatus, setAccountSyncStatus } from '@services/bank-data-providers/sync/sync-status-tracker';
import { writeBankBalanceWithHistory } from '@services/bank-data-providers/utils/write-bank-balance-with-history';
import { withTransaction } from '@services/common/with-transaction';

interface LinkAccountToBankConnectionPayload {
  accountId: string;
  connectionId: string;
  externalAccountId: string;
  userId: number;
  residualTarget?: LinkResidualTarget;
}

interface LinkResult {
  account: Accounts;
  balanceDifference: number;
}

/**
 * Swaps a system account to the provider's type, syncs the provider's
 * transactions, and puts the unexplained balance residual where
 * `residualTarget` says (opening balance or one adjustment row). Queue-synced
 * providers (metadata.features.queuedSync) get the bank balance written inline
 * and the sync plus residual absorb deferred to the queue via the
 * `pendingAbsorb` marker.
 */
export const linkAccountToBankConnection = withTransaction(
  async ({
    accountId,
    connectionId,
    externalAccountId,
    userId,
    residualTarget = 'opening-balance',
  }: LinkAccountToBankConnectionPayload): Promise<LinkResult> => {
    const account = await getAccountById({ id: accountId, userId });

    if (!account) {
      throw new NotFoundError({
        message: `Account with id "${accountId}" not found.`,
        code: API_ERROR_CODES.notFound,
      });
    }

    if (account.type !== ACCOUNT_TYPES.system) {
      throw new ValidationError({
        message: 'Only system accounts can be linked to a bank connection.',
      });
    }

    assertNotDerivedBalanceAccount({ account, actionPhrase: 'be linked to a bank connection' });

    const bankConnection = await BankDataProviderConnections.findOne({
      where: {
        id: connectionId,
        userId,
      },
    });

    if (!bankConnection) {
      throw new NotFoundError({
        message: `Bank connection with id "${connectionId}" not found.`,
        code: API_ERROR_CODES.notFound,
      });
    }

    if (!bankConnection.isActive) {
      throw new ValidationError({
        message: 'Cannot link to an inactive bank connection.',
      });
    }

    const provider = bankProviderRegistry.get(bankConnection.providerType as BANK_PROVIDER_TYPE);
    const externalAccounts = await provider.fetchAccounts(connectionId);

    const externalAccount = externalAccounts.find((acc) => acc.externalId === externalAccountId);

    if (!externalAccount) {
      throw new NotFoundError({
        message: `External account with id "${externalAccountId}" not found in this connection.`,
        code: API_ERROR_CODES.notFound,
      });
    }

    if (externalAccount.currency.toLowerCase() !== account.currencyCode.toLowerCase()) {
      throw new ValidationError({
        message: `Currency mismatch: System account uses ${account.currencyCode}, but external account uses ${externalAccount.currency}. Only accounts with matching currencies can be linked.`,
      });
    }

    await assertExternalAccountNotLinkedElsewhere({
      userId,
      providerType: bankConnection.providerType,
      externalId: externalAccountId,
    });

    // Stored balances include the credit limit. Adopting the bank's limit shifts
    // the stored balance by the same delta so displayed history stays put.
    const newCreditLimit = Money.fromCents(Number(externalAccount.metadata?.creditLimit) || 0);
    if (!newCreditLimit.equals(account.creditLimit)) {
      await updateAccount({
        id: accountId,
        userId,
        creditLimit: newCreditLimit,
        currentBalance: account.currentBalance.add(newCreditLimit.subtract(account.creditLimit)),
      });
      await account.reload();
    }

    const systemBalance = account.currentBalance.toCents();
    const externalBalance = externalAccount.balance;
    const balanceDifference = externalBalance - systemBalance;

    const isQueuedSyncProvider = provider.metadata.features.queuedSync === true;

    const existingExternalData = account.externalData || {};
    const linkedAt = new Date().toISOString();

    // External account metadata (iban, ownerName, ...) is stored so reconnection
    // flows can match accounts by IBAN.
    const updatedExternalData: AccountExternalData = {
      ...existingExternalData,
      ...externalAccount.metadata,
      bankConnection: {
        linkedAt,
        linkingStrategy: 'forward-only' as const,
        balanceReconciliation: {
          systemBalance,
          externalBalance,
          difference: balanceDifference,
          adjustmentTransactionId: null,
          residualTarget,
          ...(isQueuedSyncProvider ? { pendingAbsorb: true } : {}),
        },
      },
    };

    const newAccountType = PROVIDER_TO_ACCOUNT_TYPE[bankConnection.providerType as BANK_PROVIDER_TYPE];

    await account.update({
      type: newAccountType,
      externalId: externalAccountId,
      externalData: updatedExternalData,
      bankDataProviderConnectionId: connectionId,
    });

    await Subscriptions.update({ autoRecord: false }, { where: { accountId, autoRecord: true } });

    await restoreRelinkedTransactionsAccountType({
      accountId,
      providerType: bankConnection.providerType as BANK_PROVIDER_TYPE,
    });

    await bankConnection.update({ lastSyncAt: new Date() });

    const connectionGroup = await AccountGroup.findOne({
      where: { bankDataProviderConnectionId: connectionId, userId },
    });

    if (connectionGroup) {
      const existingGrouping = await AccountGrouping.findOne({
        where: { accountId },
      });

      if (!existingGrouping) {
        await AccountGrouping.create({ accountId, groupId: connectionGroup.id });
      }
    }

    if (isQueuedSyncProvider) {
      // The bank balance is already in hand from fetchAccounts; write it now
      // or the account keeps the stale pre-link figure while the queue drains,
      // forever when the sync window returns nothing.
      await writeBankBalanceWithHistory({ account, balance: Money.fromCents(externalBalance) });

      // Enqueue only after this transaction commits: the first queue batch
      // runs immediately, and a worker racing an uncommitted link would read
      // pre-link account state and commit rows that corrupt the residual math.
      const sequelizeTx = namespace.get('transaction');
      const startPostLinkSync = () => {
        syncTransactionsForAccount({ connectionId, userId, accountId }).catch(async (error: Error) => {
          logger.error(
            { message: 'Post-link transaction sync failed to start', error },
            { code: 'ACCOUNT_LINK_POST_COMMIT_SYNC_FAILED', accountId, connectionId, userId },
          );
          // The link already returned 200; without this the account shows no
          // sync state at all and the failure is invisible until the next sync.
          await setAccountSyncStatus({
            accountId: accountId as RecordId,
            status: SyncStatus.FAILED,
            error: error.message,
            userId,
          }).catch(() => {});
        });
      };
      if (sequelizeTx) {
        sequelizeTx.afterCommit(startPostLinkSync);
      } else {
        startPostLinkSync();
      }

      const updatedAccount = (await Accounts.findByPk(accountId))!;

      return {
        account: updatedAccount,
        balanceDifference,
      };
    }

    await syncTransactionsForAccount({
      connectionId,
      userId,
      accountId,
    });

    const residualOutcome = await absorbLinkResidual({ accountId, userId });

    const updatedAccount = (await Accounts.findByPk(accountId))!;

    if (Object.keys(residualOutcome).length > 0) {
      const currentExternalData = (updatedAccount.externalData || {}) as AccountExternalData;
      const connectionMeta = currentExternalData.bankConnection ?? updatedExternalData.bankConnection!;

      await updatedAccount.update({
        externalData: {
          ...currentExternalData,
          bankConnection: {
            ...connectionMeta,
            balanceReconciliation: { ...connectionMeta.balanceReconciliation, ...residualOutcome },
          },
        },
      });
    }

    return {
      account: updatedAccount,
      balanceDifference,
    };
  },
);
