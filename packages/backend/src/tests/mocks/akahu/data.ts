import { asDecimal } from '@bt/shared/types';
import type {
  AkahuApiAccount,
  AkahuApiAccountsResponse,
  AkahuApiMe,
  AkahuApiTransaction,
  AkahuApiTransactionsResponse,
} from '@services/bank-data-providers/akahu/types';
import { subDays } from 'date-fns';

export const AKAHU_ACCOUNT_1_ID = 'acc_1111111111111111111111111';
export const AKAHU_ACCOUNT_2_ID = 'acc_2222222222222222222222222';
export const AKAHU_ACCOUNT_NO_TX_ID = 'acc_3333333333333333333333333';
export const AKAHU_ACCOUNT_INACTIVE_ID = 'acc_4444444444444444444444444';

const accountBase = (overrides: Partial<AkahuApiAccount>): AkahuApiAccount => ({
  _id: 'acc_x',
  name: 'Account',
  type: 'SAVINGS',
  status: 'ACTIVE',
  balance: { available: asDecimal(0), current: asDecimal(0), currency: 'NZD' },
  attributes: ['TRANSACTIONS'],
  connection: { _id: 'conn_test', name: 'Test Bank NZ', logo: 'https://example.com/akahu-logo.png' },
  refreshed: { balance: new Date().toISOString(), transactions: new Date().toISOString() },
  ...overrides,
});

export const getMockedAkahuAccounts = (): AkahuApiAccountsResponse => ({
  success: true,
  items: [
    accountBase({
      _id: AKAHU_ACCOUNT_1_ID,
      name: 'Everyday Account',
      type: 'CHECKER',
      formatted_account: '01-1234-1234567-00',
      meta: { holder: 'Test User' },
      balance: { available: asDecimal(1523.45), current: asDecimal(1523.45), currency: 'NZD', overdrawn: false },
    }),
    accountBase({
      _id: AKAHU_ACCOUNT_2_ID,
      name: 'Savings Account',
      balance: { available: asDecimal(8500), current: asDecimal(8500), currency: 'NZD', overdrawn: false },
    }),
    // No TRANSACTIONS attribute → must be filtered out by fetchAccounts
    accountBase({
      _id: AKAHU_ACCOUNT_NO_TX_ID,
      name: 'Term Deposit',
      type: 'TERM_DEPOSIT',
      attributes: ['BALANCE'],
    }),
    // INACTIVE → must be filtered out by fetchAccounts
    accountBase({
      _id: AKAHU_ACCOUNT_INACTIVE_ID,
      name: 'Closed Account',
      status: 'INACTIVE',
    }),
  ],
});

export const getMockedAkahuAccount = ({ accountId }: { accountId: string }): AkahuApiAccount => {
  const { items } = getMockedAkahuAccounts();
  const found = items.find((a) => a._id === accountId);
  return (
    found ??
    accountBase({
      _id: accountId,
      balance: { available: asDecimal(1523.45), current: asDecimal(1523.45), currency: 'NZD', overdrawn: false },
    })
  );
};

export const getMockedAkahuMe = (): AkahuApiMe => ({
  success: true,
  item: {
    _id: 'usr_test',
    name: 'Test User',
    email: 'test@example.com',
    access_granted_at: subDays(new Date(), 30).toISOString(),
  },
});

export const getMockedAkahuTransactions = (
  amount = 5,
  accountId = AKAHU_ACCOUNT_1_ID,
): AkahuApiTransactionsResponse => {
  const currentDate = new Date();

  const transactions: AkahuApiTransaction[] = Array.from({ length: amount }, (_, index) => {
    // Fixed amounts, not faker: the default handler and a test override can
    // both answer one sync, and a random id on each call would import twice.
    const txAmount = 10 + index;
    // Akahu signs amounts: negative = money out (debit), positive = money in (credit).
    const signedAmount = index % 3 === 0 ? txAmount : -txAmount;

    return {
      _id: `trans_${index}_${accountId.slice(4, 12)}`,
      _account: accountId,
      _connection: 'conn_test',
      created_at: subDays(currentDate, index).toISOString(),
      date: subDays(currentDate, index).toISOString(),
      description: `Payment ${index}`,
      amount: asDecimal(signedAmount),
      balance: asDecimal(1000 + index),
      type: signedAmount < 0 ? 'EFTPOS' : 'DIRECT CREDIT',
      merchant:
        signedAmount < 0
          ? { _id: `merchant_${index}`, name: `Merchant ${index}`, website: 'https://example.com' }
          : null,
      category: signedAmount < 0 ? { _id: 'nzfcc_test', name: 'Cafes & Restaurants' } : null,
    };
  });

  // Akahu returns newest first.
  return {
    success: true,
    items: transactions,
    cursor: { next: null },
  };
};
