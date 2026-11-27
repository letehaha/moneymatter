import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { t } from '@i18n/index';
import { NotAllowedError } from '@js/errors';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { withTransaction } from '@root/services/common/with-transaction';

import { EnableBankingProvider } from '../enablebanking';
import { PlaidProvider } from '../plaid';
import { isProviderAvailableForUser } from '../provider-availability';
import { bankProviderRegistry } from '../registry';

const connectProviderInTransaction = withTransaction(
  async ({
    providerType,
    userId,
    credentials,
    providerName,
    externalUrl,
  }: {
    providerType: BANK_PROVIDER_TYPE;
    userId: number;
    credentials: Record<string, unknown>;
    providerName?: string;
    externalUrl?: string | null;
  }): Promise<{ connectionId: string; authUrl?: string; message: string }> => {
    if (!(await isProviderAvailableForUser({ userId, providerType }))) {
      throw new NotAllowedError({ message: t({ key: 'bankDataProviders.providerNotAvailable' }) });
    }

    const provider = bankProviderRegistry.get(providerType);

    // Create connection (stores encrypted credentials)
    const connectionId = await provider.connect(userId, credentials);

    // Update provider name or external URL if provided
    const patch: { providerName?: string; externalUrl?: string | null } = {};
    if (providerName) patch.providerName = providerName;
    if (externalUrl !== undefined) patch.externalUrl = externalUrl;
    if (Object.keys(patch).length > 0) {
      await BankDataProviderConnections.update(patch, { where: { id: connectionId } });
    }

    // For Enable Banking, get the authorization URL
    let authUrl: string | undefined;
    if (providerType === BANK_PROVIDER_TYPE.ENABLE_BANKING) {
      const enableBankingProvider = provider as EnableBankingProvider;
      authUrl = await enableBankingProvider.getAuthorizationUrl(connectionId);
    }

    return {
      connectionId,
      authUrl,
      message: authUrl
        ? 'Connection created. Please authorize access via the provided URL.'
        : 'Provider connected successfully',
    };
  },
);

export const connectProvider = async (params: Parameters<typeof connectProviderInTransaction>[0]) => {
  if (params.providerType !== BANK_PROVIDER_TYPE.PLAID) return connectProviderInTransaction(params);
  if (!(await isProviderAvailableForUser({ userId: params.userId, providerType: params.providerType }))) {
    throw new NotAllowedError({ message: t({ key: 'bankDataProviders.providerNotAvailable' }) });
  }
  const provider = bankProviderRegistry.get(params.providerType) as PlaidProvider;
  const connectionId = await provider.connectWithDetails(params);
  return { connectionId, authUrl: undefined, message: 'Provider connected successfully' };
};
