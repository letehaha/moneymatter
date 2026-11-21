import { roundMoneyValues } from '@common/lib/currency-precision';
import type { Money } from '@common/types/money';
import { removeUndefinedKeys } from '@js/helpers';

interface TransactionMoneyFields {
  amount?: Money;
  commissionRate?: Money;
  cashbackAmount?: Money;
  originalAmount?: Money | null;
  refAmount?: Money;
  refCommissionRate?: Money;
}

/**
 * Rounds the money fields of a transaction write to the decimals of the currency each one is
 * denominated in. Amounts the user or a provider enters (`amount`, `commissionRate`,
 * `cashbackAmount`, `originalAmount`) round half-up to the account currency and to the original
 * currency; converted values (`refAmount`, `refCommissionRate`) round half-even to the reference
 * currency. A field that is absent stays absent, so a partial update keeps its meaning.
 *
 * Without `refCurrencyCode` the reference values are left as given, since there is no currency to
 * round them to. When the reference currency is the account currency, no conversion happened and
 * each reference value is its native value, so it rounds half-up like the native one and the two
 * stay equal.
 */
export const roundTransactionMoney = async <TValues extends TransactionMoneyFields>({
  values,
  userId,
  definitionOwnerUserId,
  currencyCode,
  refCurrencyCode,
  originalCurrencyCode,
}: {
  values: TValues;
  /** The writer, whose definition of `originalCurrencyCode` rounds `originalAmount`. */
  userId: number;
  /** Whose definition of `currencyCode` rounds the native amounts: the account owner's. */
  definitionOwnerUserId: number;
  currencyCode: string;
  refCurrencyCode: string | null | undefined;
  originalCurrencyCode: string | null | undefined;
}): Promise<TValues> => {
  const { originalAmount, refAmount, refCommissionRate, ...native } = values;

  const roundedNative = await roundMoneyValues({
    values: { amount: native.amount, commissionRate: native.commissionRate, cashbackAmount: native.cashbackAmount },
    userId: definitionOwnerUserId,
    currencyCode,
    mode: 'half-up',
  });
  const roundedRef = refCurrencyCode
    ? await roundMoneyValues({
        values: { refAmount, refCommissionRate },
        userId,
        currencyCode: refCurrencyCode,
        mode: refCurrencyCode === currencyCode ? 'half-up' : 'half-even',
      })
    : { refAmount, refCommissionRate };
  // An original amount without its currency cannot be rounded to a currency. It is stored as given,
  // like the row itself, which a validation upstream keeps from happening.
  const roundedOriginal = originalCurrencyCode
    ? await roundMoneyValues({
        values: { originalAmount },
        userId,
        currencyCode: originalCurrencyCode,
        mode: 'half-up',
      })
    : { originalAmount };

  return {
    ...values,
    ...removeUndefinedKeys({ ...roundedNative, ...roundedRef, ...roundedOriginal }),
  };
};
