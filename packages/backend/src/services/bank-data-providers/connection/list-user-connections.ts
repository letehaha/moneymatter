import { ACCOUNT_STATUSES } from '@bt/shared/types';
import Accounts from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';

import { getConnectionBankName, resolveBankLogoDomain } from '../utils/bank-institutions';

export const listUserConnections = async ({
  userId,
}: {
  userId: number;
}): Promise<
  (Pick<
    BankDataProviderConnections,
    'id' | 'providerType' | 'providerName' | 'externalUrl' | 'isActive' | 'lastSyncAt' | 'createdAt'
  > & { accountsCount: number; bankName: string | null; bankLogoDomain: string | null })[]
> => {
  const connections = await BankDataProviderConnections.findAll({
    where: { userId },
    include: [
      {
        model: Accounts,
        as: 'accounts',
        where: { status: ACCOUNT_STATUSES.active },
        required: false,
      },
    ],
    order: [['createdAt', 'DESC']],
  });

  return connections.map((conn) => {
    const bankName = getConnectionBankName({ metadata: conn.metadata });
    return {
      id: conn.id,
      providerType: conn.providerType,
      providerName: conn.providerName,
      externalUrl: conn.externalUrl,
      isActive: conn.isActive,
      lastSyncAt: conn.lastSyncAt,
      accountsCount: conn.accounts?.length || 0,
      createdAt: conn.createdAt,
      bankName,
      bankLogoDomain: resolveBankLogoDomain({ bankName }),
    };
  });
};
