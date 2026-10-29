import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import Accounts from '@models/accounts.model';
import Transactions from '@models/transactions.model';
import * as helpers from '@tests/helpers';
import { getMockedAkahuTransactions } from '@tests/mocks/akahu/data';
import { VALID_AKAHU_APP_TOKEN, VALID_AKAHU_USER_TOKEN, getAkahuTransactionsMock } from '@tests/mocks/akahu/mock-api';

/**
 * Creates an Akahu connection WITHOUT connecting accounts or triggering sync.
 * This allows tests to set up mocks before any sync happens.
 */
const pairAkahuUser = async ({
  userToken = VALID_AKAHU_USER_TOKEN,
  appToken = VALID_AKAHU_APP_TOKEN,
}: { userToken?: string; appToken?: string } = {}) => {
  const { connectionId } = await helpers.bankDataProviders.connectProvider({
    providerType: BANK_PROVIDER_TYPE.AKAHU,
    credentials: { userToken, appToken },
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

/**
 * Set up mocks, connect external accounts, and return the first created account with transactions.
 */
async function connectAccountsAndSync({
  connectionId,
  mockedTransactions,
  accountId,
}: {
  connectionId: string;
  mockedTransactions: ReturnType<typeof getMockedAkahuTransactions>;
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
