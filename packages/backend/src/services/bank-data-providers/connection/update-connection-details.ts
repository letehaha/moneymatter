import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import AccountGroup from '@models/accounts-groups/account-groups.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { withTransaction } from '@services/common/with-transaction';

interface UpdateConnectionDetailsParams {
  connectionId: string;
  userId: number;
  providerName?: string;
  externalUrl?: string | null;
}

/**
 * Update a bank connection's display name and/or external URL.
 * If the connection has a linked AccountGroup whose name still matches the old
 * connection name, the group name is synced automatically. If the user has
 * manually renamed the group, the sync is skipped.
 */
export const updateConnectionDetails = withTransaction(
  async ({ connectionId, userId, providerName, externalUrl }: UpdateConnectionDetailsParams) => {
    const connection = await findOrThrowNotFound({
      query: BankDataProviderConnections.findOne({
        where: { id: connectionId, userId },
      }),
      message: t({ key: 'errors.connectionNotFound' }),
    });

    const oldProviderName = connection.providerName;
    if (providerName !== undefined) connection.providerName = providerName;
    if (externalUrl !== undefined) connection.externalUrl = externalUrl;
    await connection.save();

    if (providerName === undefined) return connection;

    // Sync the account group name if it still matches the old connection name.
    // If the group name differs, the user has manually renamed it — skip the sync.
    const connectionGroup = await AccountGroup.findOne({
      where: { bankDataProviderConnectionId: connectionId, userId },
    });

    if (connectionGroup && connectionGroup.name === oldProviderName) {
      connectionGroup.name = providerName;
      await connectionGroup.save();
    }

    return connection;
  },
);
