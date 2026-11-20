import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { beforeEach, describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { useSelfHost } from '@tests/helpers/self-host';
import { MOCK_IDENTIFICATION_HASH_1 } from '@tests/mocks/enablebanking/data';
import { VALID_MONOBANK_TOKEN } from '@tests/mocks/monobank/mock-api';

const connectEnableBanking = async ({ bankName, withAccount }: { bankName: string; withAccount: boolean }) => {
  const { connectionId } = await helpers.bankDataProviders.connectProvider({
    providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
    credentials: { ...helpers.enablebanking.mockCredentials(), bankName },
    raw: true,
  });
  if (!withAccount) return { connectionId, accountId: null };

  await helpers.makeRequest({
    method: 'post',
    url: '/bank-data-providers/enablebanking/oauth-callback',
    payload: {
      connectionId,
      code: helpers.enablebanking.mockAuthCode,
      state: await helpers.enablebanking.getConnectionState(connectionId),
    },
  });
  const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
    connectionId,
    accountExternalIds: [MOCK_IDENTIFICATION_HASH_1],
    raw: true,
  });
  return { connectionId, accountId: syncedAccounts[0]!.id };
};

const connectMonobankWithAccount = async () => {
  const { connectionId } = await helpers.bankDataProviders.connectProvider({
    providerType: BANK_PROVIDER_TYPE.MONOBANK,
    credentials: { apiToken: VALID_MONOBANK_TOKEN },
    raw: true,
  });
  const { accounts } = await helpers.bankDataProviders.listExternalAccounts({ connectionId, raw: true });
  const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
    connectionId,
    accountExternalIds: [accounts[0]!.externalId],
    raw: true,
  });
  return { connectionId, accountId: syncedAccounts[0]!.id };
};

useSelfHost();

describe('bankLogoDomain on bank connection endpoints', () => {
  beforeEach(() => {
    helpers.enablebanking.resetSessionCounter();
  });

  describe('GET /bank-data-providers/connections', () => {
    it('returns an empty list when the user has no connections', async () => {
      const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      expect(connections).toEqual([]);
    });

    it('resolves matched, unmatched and missing bank names', async () => {
      const matched = await connectEnableBanking({ bankName: 'mBank', withAccount: false });
      const unmatched = await connectEnableBanking({ bankName: 'Nonexistent Bank XYZ 12345', withAccount: false });
      const { connectionId: noBankNameId } = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });

      expect(connections.find((c) => c.id === matched.connectionId)).toMatchObject({
        bankName: 'mBank',
        bankLogoDomain: 'mbank.pl',
      });
      expect(connections.find((c) => c.id === unmatched.connectionId)).toMatchObject({ bankLogoDomain: null });
      expect(connections.find((c) => c.id === noBankNameId)).toMatchObject({ bankName: null, bankLogoDomain: null });
    });
  });

  describe('GET /bank-data-providers/sync/status', () => {
    it('adds connection id, account logo fields and bankLogoDomain to each account', async () => {
      const matched = await connectEnableBanking({ bankName: 'mBank', withAccount: true });
      const noBankName = await connectMonobankWithAccount();

      const { accounts } = await helpers.bankDataProviders.getAccountsSyncStatus({ raw: true });

      expect(accounts.find((a) => a.accountId === matched.accountId)).toMatchObject({
        bankDataProviderConnectionId: matched.connectionId,
        bankLogoDomain: 'mbank.pl',
        logoDomain: null,
        logoInitials: null,
        logoColor: null,
        logoIcon: null,
        logoImageId: null,
      });
      expect(accounts.find((a) => a.accountId === noBankName.accountId)).toMatchObject({
        bankDataProviderConnectionId: noBankName.connectionId,
        bankLogoDomain: null,
      });
    });
  });
});
