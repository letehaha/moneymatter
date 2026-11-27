import type { PlaidAccount, PlaidTransaction } from '@services/bank-data-providers/plaid/api-client';
import { subDays } from 'date-fns';

export const PLAID_PUBLIC_TOKEN = 'public-sandbox-fake';
export const PLAID_ACCESS_TOKEN = 'access-sandbox-fake';
export const PLAID_ITEM_ID = 'item-fake';
export const PLAID_ACCOUNT_ID = 'plaid-checking';

export const getMockedPlaidAccounts = (): PlaidAccount[] => [
  {
    account_id: PLAID_ACCOUNT_ID,
    name: 'Checking',
    type: 'depository',
    subtype: 'checking',
    balances: { current: 145.25, available: 140, limit: null, iso_currency_code: global.BASE_CURRENCY_CODE },
  },
];
export const checking = (): PlaidAccount => ({
  account_id: 'plaid-checking',
  name: 'Checking',
  type: 'depository',
  subtype: 'checking',
  balances: { current: 145.25, available: 140, limit: null, iso_currency_code: global.BASE_CURRENCY_CODE },
});

export const credit = (): PlaidAccount => ({
  ...checking(),
  account_id: 'plaid-credit',
  name: 'Credit card',
  type: 'credit',
  subtype: 'credit card',
  balances: { ...checking().balances, current: 31.5, limit: 1000 },
});

export const posted = ({
  id,
  amount = 12,
  account = checking(),
  pending = false,
}: {
  id: string;
  amount?: number;
  account?: PlaidAccount;
  pending?: boolean;
}): PlaidTransaction => ({
  transaction_id: id,
  account_id: account.account_id,
  amount,
  date: subDays(new Date(), 3).toISOString().slice(0, 10),
  name: `Statement ${id}`,
  merchant_name: null,
  iso_currency_code: account.balances.iso_currency_code,
  pending,
});
