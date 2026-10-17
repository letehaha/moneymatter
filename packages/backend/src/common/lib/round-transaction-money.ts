import { roundMoneyValues } from '@common/lib/currency-precision';
import type { Money } from '@common/types/money';

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
 * `refCurrencyCode` falls back to the account currency: a row without a reference currency holds
 * its reference values in the account's own. When the reference currency is the account currency,
 * no conversion happened and each reference value is its native value, so it rounds half-up like
 * the native one and the two stay equal.
 */
export const roundTransactionMoney = async <TValues extends TransactionMoneyFields>({
  values,
  userId,
  accountOwnerUserId = userId,
  currencyCode,
  refCurrencyCode,
  originalCurrencyCode,
}: {
  values: TValues;
  userId: number;
  accountOwnerUserId?: number;
  currencyCode: string;
  refCurrencyCode: string | null | undefined;
  originalCurrencyCode: string | null | undefined;
}): Promise<TValues> => {
  const { originalAmount, refAmount, refCommissionRate, ...native } = values;

  const roundedNative = await roundMoneyValues({
    values: { amount: native.amount, commissionRate: native.commissionRate, cashbackAmount: native.cashbackAmount },
    userId: accountOwnerUserId,
    currencyCode,
    mode: 'half-up',
  });
  const resolvedRefCurrencyCode = refCurrencyCode ?? currencyCode;
  const roundedRef = await roundMoneyValues({
    values: { refAmount, refCommissionRate },
    // A reference value in the account's own currency is its native value, so it follows the owner.
    userId: resolvedRefCurrencyCode === currencyCode ? accountOwnerUserId : userId,
    currencyCode: resolvedRefCurrencyCode,
    mode: resolvedRefCurrencyCode === currencyCode ? 'half-up' : 'half-even',
  });
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
    ...stripUndefined({ ...roundedNative, ...roundedRef, ...roundedOriginal }),
  };
};

const stripUndefined = <TObject extends Record<string, unknown>>(object: TObject): Partial<TObject> =>
  Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)) as Partial<TObject>;
