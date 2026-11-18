import { API_ERROR_CODES, BANK_PROVIDER_TYPE, Decimal } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { NotFoundError } from '@js/errors';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { withTransaction } from '@root/services/common/with-transaction';
import { ProviderAccount, bankProviderRegistry } from '@services/bank-data-providers';

export const listExternalAccounts = withTransaction(
  async ({
    connectionId,
    userId,
  }: {
    connectionId: string;
    userId: number;
  }): Promise<(Omit<ProviderAccount, 'balance'> & { balance: Decimal; creditLimit: Decimal })[]> => {
    const connection = await BankDataProviderConnections.findOne({
      where: {
        id: connectionId,
        userId,
      },
    });

    if (!connection) {
      throw new NotFoundError({
        message: t({ key: 'errors.connectionNotFound' }),
        code: API_ERROR_CODES.notFound,
      });
    }

    const provider = bankProviderRegistry.get(connection.providerType as BANK_PROVIDER_TYPE);
    const accounts = await provider.fetchAccounts(connectionId);

    return accounts.map((acc) => ({
      externalId: acc.externalId,
      name: acc.name,
      type: acc.type,
      balance: Money.fromCents(acc.balance ?? 0).toNumber(),
      creditLimit: Money.fromCents(Number(acc.metadata?.creditLimit) || 0).toNumber(),
      currency: acc.currency,
      metadata: acc.metadata,
    }));
  },
);
