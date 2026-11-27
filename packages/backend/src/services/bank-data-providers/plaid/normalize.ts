import { isCurrencyCodeFormat } from '@common/lib/currency-code-format';
import { Money } from '@common/types/money';

import type { ProviderAccount, SyncedTransactionRow } from '../types';
import type { PlaidAccount, PlaidTransaction } from './api-client';

export const normalizePlaidAccount = ({ account }: { account: PlaidAccount }): ProviderAccount | null => {
  if (account.type !== 'depository' && account.type !== 'credit') return null;
  const { current, limit, iso_currency_code: currency } = account.balances;
  if (!currency || !isCurrencyCodeFormat(currency)) return null;

  return {
    externalId: account.account_id,
    name: account.name,
    type: account.subtype ?? account.type,
    balance: current === null ? null : Money.fromDecimal(account.type === 'credit' ? -current : current),
    ...(account.type === 'credit' && limit !== null ? { creditLimit: Money.fromDecimal(Math.abs(limit)) } : {}),
    currency,
  };
};

export const normalizePlaidTransaction = ({
  transaction,
  accountCurrency,
}: {
  transaction: PlaidTransaction;
  accountCurrency: string;
}): SyncedTransactionRow | null => {
  if (transaction.pending || transaction.iso_currency_code !== accountCurrency) return null;

  return {
    originalId: transaction.transaction_id,
    time: new Date(`${transaction.date}T00:00:00.000Z`),
    // Plaid uses positive amounts for outflows; MoneyMatter's ingestion uses negatives.
    amount: -transaction.amount,
    note: transaction.name,
    rawMerchantName: transaction.merchant_name,
    externalData: { plaidAccountId: transaction.account_id },
  };
};
