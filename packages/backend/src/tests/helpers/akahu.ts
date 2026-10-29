import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import Accounts from '@models/accounts.model';
import Transactions from '@models/transactions.model';
import type { AkahuApiTransactionsResponse } from '@services/bank-data-providers/akahu/types';
import * as helpers from '@tests/helpers';
import { VALID_AKAHU_APP_TOKEN, VALID_AKAHU_USER_TOKEN, getAkahuTransactionsMock } from '@tests/mocks/akahu/mock-api';

/**
 * Creates an Akahu connection WITHOUT connecting accounts or triggering sync.
 * This allows tests to set up mocks before any sync happens.
 */
const pairAkahuUser = async () => {
  const { connectionId } = await helpers.bankDataProviders.connectProvider({
    providerType: BANK_PROVIDER_TYPE.AKAHU,
    credentials: { userToken: VALID_AKAHU_USER_TOKEN, appToken: VALID_AKAHU_APP_TOKEN },
    raw: true,
  });

  return { connectionId };
};

const getTransactions = async () => {
  return helpers.extractResponse(
    await helpers.makeRequest({
      method: 'get',
      url: '/transactions',
    }),
  );
};

async function connectAccountsAndSync({
  connectionId,
  mockedTransactions,
  accountId,
}: {
  connectionId: string;
  mockedTransactions: AkahuApiTransactionsResponse;
  accountId: string;
}): Promise<{ account: Accounts; transactions: Transactions[] }> {
  global.mswMockServer.use(getAkahuTransactionsMock({ response: mockedTransactions, accountId }));

  const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
    connectionId,
    accountExternalIds: [accountId],
    raw: true,
  });

  const account = await Accounts.findByPk(syncedAccounts[0]!.id);
  const transactions = await getTransactions();

  return { account: account!, transactions };
}

export default {
  pairAkahuUser,
  connectAccountsAndSync,
};
