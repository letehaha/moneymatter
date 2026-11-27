import { isCurrencyCodeFormat } from '@common/lib/currency-code-format';
import { Money } from '@common/types/money';
import { logger } from '@js/utils';

import type { ProviderAccount, SyncedTransactionRow } from '../types';
import type { PlaidAccount, PlaidTransaction } from './api-client';

export const normalizePlaidAccount = ({ account }: { account: PlaidAccount }): ProviderAccount | null => {
  if (account.type !== 'depository' && account.type !== 'credit') return null;
  const { current, limit, iso_currency_code: currency } = account.balances;
  if (!currency || !isCurrencyCodeFormat(currency)) {
    logger.warn('[Plaid] Skipped an account without an ISO currency code', { plaidAccountId: account.account_id });
    return null;
  }

  const base = { externalId: account.account_id, name: account.name, type: account.subtype ?? account.type, currency };
  if (account.type === 'depository') {
    return { ...base, balance: current === null ? null : Money.fromDecimal(current) };
  }
  // Synced card balances are limit-inclusive (available credit), like other providers'.
  const creditLimit = limit === null ? null : Money.fromDecimal(Math.abs(limit));
  return {
    ...base,
    balance: current === null ? null : (creditLimit ?? Money.zero()).subtract(Money.fromDecimal(current)),
    ...(creditLimit && { creditLimit }),
  };
};

export const normalizePlaidTransaction = ({
  transaction,
  accountCurrency,
}: {
  transaction: PlaidTransaction;
  accountCurrency: string;
}): SyncedTransactionRow | null => {
  if (transaction.pending) return null;
  if (transaction.iso_currency_code !== accountCurrency) {
    logger.warn('[Plaid] Skipped a transaction whose currency differs from its account', {
      plaidTransactionId: transaction.transaction_id,
      plaidAccountId: transaction.account_id,
    });
    return null;
  }

  return {
    originalId: transaction.transaction_id,
    time: new Date(`${transaction.date}T00:00:00.000Z`),
    // Plaid uses positive amounts for outflows; MoneyMatter's ingestion uses negatives.
    amount: -transaction.amount,
    note: transaction.name,
    rawMerchantName: transaction.merchant_name ?? null,
    externalData: { plaidAccountId: transaction.account_id },
  };
};
