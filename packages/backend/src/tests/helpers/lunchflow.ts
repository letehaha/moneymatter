import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import Accounts from '@models/accounts.model';
import Transactions from '@models/transactions.model';
import * as helpers from '@tests/helpers';
import { getMockedLunchFlowAccounts, getMockedLunchFlowTransactions } from '@tests/mocks/lunchflow/data';
import {
  VALID_LUNCHFLOW_API_KEY,
  getLunchFlowBalanceMock,
  getLunchFlowTransactionsMock,
} from '@tests/mocks/lunchflow/mock-api';

/**
 * Creates a LunchFlow connection WITHOUT connecting accounts or triggering sync.
 * This allows tests to set up mocks before any sync happens.
 */
const pairLunchFlowUser = async (apiKey: string = VALID_LUNCHFLOW_API_KEY) => {
  const { connectionId } = await helpers.bankDataProviders.connectProvider({
    providerType: BANK_PROVIDER_TYPE.LUNCHFLOW,
    credentials: { apiKey },
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
}: {
  connectionId: string;
  mockedTransactions: ReturnType<typeof getMockedLunchFlowTransactions>;
}): Promise<{ account: Accounts; transactions: Transactions[] }> {
  global.mswMockServer.use(getLunchFlowTransactionsMock({ response: mockedTransactions }), getLunchFlowBalanceMock());

  const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
    connectionId,
    raw: true,
  });
  const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
    connectionId,
    accountExternalIds: externalAccounts.map((acc) => acc.externalId),
    raw: true,
  });

  const account = await Accounts.findByPk(syncedAccounts[0]!.id);
  const transactions = await getTransactions();

  return { account: account!, transactions };
}

/**
 * Creates a LunchFlow connection, connects accounts, and syncs transactions
 * with mocked data. Returns the created account and its transactions.
 */
const addTransactions = async ({ amount = 5 }: { amount?: number } = {}): Promise<{
  account: Accounts;
  transactions: Transactions[];
}> => {
  const mockedTransactions = getMockedLunchFlowTransactions(amount);

  // Check if there's already a connected LunchFlow connection
  const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
  const existingConnection = connections.find(
    (c: { providerType: string }) => c.providerType === BANK_PROVIDER_TYPE.LUNCHFLOW,
  );

  // No existing connection -- create one and connect accounts
  if (!existingConnection) {
    const { connectionId } = await pairLunchFlowUser();
    return connectAccountsAndSync({ connectionId, mockedTransactions });
  }

  const connectionId = existingConnection.id;

  const { connection } = await helpers.bankDataProviders.getConnectionDetails({
    connectionId,
    raw: true,
  });

  // Existing connection without accounts -- connect them
  if (connection.accounts.length === 0) {
    return connectAccountsAndSync({ connectionId, mockedTransactions });
  }

  // Existing connection with accounts -- sync new transactions to the first account
  const account = await Accounts.findByPk(connection.accounts[0]!.id);

  if (!account) {
    throw new Error('Account not found after pairing');
  }

  global.mswMockServer.use(getLunchFlowTransactionsMock({ response: mockedTransactions }), getLunchFlowBalanceMock());

  await helpers.bankDataProviders.syncTransactionsForAccount({
    connectionId,
    accountId: account.id,
    raw: true,
  });

  const transactions = await getTransactions();

  return { account, transactions };
};

/**
 * Links an existing manual account to LunchFlow account 1001 with an empty statement.
 * The account must be USD, the currency of account 1001.
 */
const linkManualAccount = async ({ accountId }: { accountId: string }) => {
  const { connectionId } = await pairLunchFlowUser();

  global.mswMockServer.use(getLunchFlowTransactionsMock({ response: { transactions: [], total: 0 } }));

  const response = await helpers.linkAccountToBankConnection({
    id: accountId,
    connectionId,
    externalAccountId: '1001',
  });
  if (response.statusCode !== 200) {
    throw new Error(`Linking account ${accountId} to LunchFlow failed with status ${response.statusCode}`);
  }
};

export default {
  pair: pairLunchFlowUser,
  linkManualAccount,
  getTransactions,
  mockTransactions: addTransactions,
  mockedAccountsData: getMockedLunchFlowAccounts,
  mockedTransactionData: getMockedLunchFlowTransactions,
  mockedApiKey: VALID_LUNCHFLOW_API_KEY,
};
