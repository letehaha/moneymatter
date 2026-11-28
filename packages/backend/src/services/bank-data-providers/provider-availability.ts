import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { isSelfHost } from '@config/is-self-host';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';

import { getPlaidConfig } from './plaid/api-client';

/**
 * Enable Banking is closed to new cloud users. Self-hosted instances keep it, and so do
 * cloud users who already hold an Enable Banking connection.
 */
export const isProviderAvailableForUser = async ({
  userId,
  providerType,
}: {
  userId: number;
  providerType: BANK_PROVIDER_TYPE;
}): Promise<boolean> => {
  if (providerType === BANK_PROVIDER_TYPE.PLAID) return getPlaidConfig() !== null;
  if (providerType !== BANK_PROVIDER_TYPE.ENABLE_BANKING || isSelfHost()) return true;

  return (await BankDataProviderConnections.count({ where: { userId, providerType } })) > 0;
};
