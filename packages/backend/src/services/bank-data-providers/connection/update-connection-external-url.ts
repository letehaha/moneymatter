import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { withTransaction } from '@services/common/with-transaction';

interface UpdateConnectionExternalUrlParams {
  connectionId: string;
  userId: number;
  externalUrl: string | null;
}

/** Update or clear a bank connection's optional external institution URL. */
export const updateConnectionExternalUrl = withTransaction(
  async ({ connectionId, userId, externalUrl }: UpdateConnectionExternalUrlParams) => {
    const connection = await findOrThrowNotFound({
      query: BankDataProviderConnections.findOne({
        where: { id: connectionId, userId },
      }),
      message: t({ key: 'errors.connectionNotFound' }),
    });

    connection.externalUrl = externalUrl;
    await connection.save();

    return connection;
  },
);
