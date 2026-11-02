import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { isSelfHost } from '@config/is-self-host';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';

/**
 * Enable Banking is closed to new cloud users; cloud users who already hold a connection keep it. YAXI is closed to
 * every cloud user until its terms for hosted use are confirmed: a backup restore can create a connection row, so
 * holding one proves nothing. Self-hosted instances keep both, and local dev keeps YAXI because dev does not set
 * `IS_SELF_HOST`.
 */
export const isProviderAvailableForUser = async ({
  userId,
  providerType,
}: {
  userId: number;
  providerType: BANK_PROVIDER_TYPE;
}): Promise<boolean> => {
  if (isSelfHost()) return true;
  if (providerType === BANK_PROVIDER_TYPE.YAXI) return process.env.NODE_ENV === 'development';
  if (providerType === BANK_PROVIDER_TYPE.ENABLE_BANKING) {
    return (await BankDataProviderConnections.count({ where: { userId, providerType } })) > 0;
  }

  return true;
};
