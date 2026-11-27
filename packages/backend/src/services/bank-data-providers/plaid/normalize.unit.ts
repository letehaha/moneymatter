import type { PlaidAccount, PlaidTransaction } from './api-client';
import { normalizePlaidAccount, normalizePlaidTransaction } from './normalize';

const checking: PlaidAccount = {
  account_id: 'plaid-checking',
  name: 'Checking',
  subtype: 'checking',
  type: 'depository',
  balances: { current: 127.31, available: 100, limit: null, iso_currency_code: 'USD' },
};

const purchase: PlaidTransaction = {
  transaction_id: 'plaid-purchase',
  account_id: checking.account_id,
  amount: 12.34,
  date: '2026-02-03',
  name: 'COFFEE SHOP',
  merchant_name: 'Coffee Shop',
  pending: false,
  iso_currency_code: 'USD',
};

it('normalizes the current balance rather than the available balance', () => {
  const account = normalizePlaidAccount({ account: checking });
  expect(account).toMatchObject({ externalId: 'plaid-checking', name: 'Checking', currency: 'USD' });
  expect(account?.balance?.toNumber()).toBe(127.31);
});

it('does not expose a depository limit that is absent from its balance', () => {
  const account = normalizePlaidAccount({
    account: { ...checking, balances: { ...checking.balances, limit: 1000 } },
  });
  expect(account?.balance?.toNumber()).toBe(127.31);
  expect(account?.creditLimit).toBeUndefined();
});

it('stores production credit card debt separately from its limit', () => {
  const account = normalizePlaidAccount({
    account: {
      ...checking,
      type: 'credit',
      balances: { ...checking.balances, current: 3174.77, limit: 30000 },
    },
  });
  expect(account?.balance?.toNumber()).toBe(-3174.77);
  expect(account?.creditLimit?.toNumber()).toBe(30000);
});

it('represents credit card debt separately from the credit limit', () => {
  const account = normalizePlaidAccount({
    account: { ...checking, type: 'credit', subtype: 'credit card', balances: { ...checking.balances, limit: 2000 } },
  });
  expect(account?.balance?.toNumber()).toBe(-127.31);
  expect(account?.creditLimit?.toNumber()).toBe(2000);
});

it.each([
  { limit: 0, current: 31.5, balance: -31.5, creditLimit: 0 },
  { limit: null, current: 31.5, balance: -31.5, creditLimit: undefined },
  { limit: 1000, current: -25, balance: 25, creditLimit: 1000 },
  { limit: -1000, current: 25, balance: -25, creditLimit: 1000 },
])('normalizes credit balance with limit $limit and debt $current', ({ limit, current, balance, creditLimit }) => {
  const account = normalizePlaidAccount({
    account: { ...checking, type: 'credit', balances: { ...checking.balances, current, limit } },
  });
  expect(account?.balance?.toNumber()).toBe(balance);
  expect(account?.creditLimit?.toNumber()).toBe(creditLimit);
});

it('does not substitute available funds when the current balance is missing', () => {
  expect(
    normalizePlaidAccount({ account: { ...checking, balances: { ...checking.balances, current: null } } })?.balance,
  ).toBeNull();
});

it('does not expose investments or accounts without a supported currency code', () => {
  expect(normalizePlaidAccount({ account: { ...checking, type: 'investment' } })).toBeNull();
  expect(
    normalizePlaidAccount({ account: { ...checking, balances: { ...checking.balances, iso_currency_code: null } } }),
  ).toBeNull();
});

it('inverts Plaid transaction signs to represent spending and refunds correctly', () => {
  expect(normalizePlaidTransaction({ transaction: purchase, accountCurrency: 'USD' })).toMatchObject({
    originalId: 'plaid-purchase',
    time: new Date('2026-02-03T00:00:00.000Z'),
    amount: -12.34,
    rawMerchantName: 'Coffee Shop',
  });
  expect(
    normalizePlaidTransaction({ transaction: { ...purchase, amount: -12.34 }, accountCurrency: 'USD' })?.amount,
  ).toBe(12.34);
});

it('skips pending transactions and refuses to post a different currency as account currency', () => {
  expect(normalizePlaidTransaction({ transaction: { ...purchase, pending: true }, accountCurrency: 'USD' })).toBeNull();
  expect(
    normalizePlaidTransaction({ transaction: { ...purchase, iso_currency_code: 'CAD' }, accountCurrency: 'USD' }),
  ).toBeNull();
});
