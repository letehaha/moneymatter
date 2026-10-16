import { type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

// Cases that need amounts rounded to the currency's own decimals. They stay skipped
// until every write path rounds per currency instead of to 2 decimals.
const itPerCurrencyRounding = it.skip;

const createAccountIn = async ({ currencyCode }: { currencyCode: string }) => {
  await helpers.addUserCurrencies({ currencyCodes: [currencyCode], raw: true });

  return helpers.createAccount({
    payload: helpers.buildAccountPayload({ currencyCode }),
    raw: true,
  });
};

const createTransactionOf = async ({
  accountId,
  amount,
  transactionType = TRANSACTION_TYPES.income,
  categoryId,
}: {
  accountId: RecordId;
  amount: number;
  transactionType?: TRANSACTION_TYPES;
  categoryId?: RecordId;
}) => {
  const [transaction] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId,
      amount,
      transactionType,
      ...(categoryId && { categoryId }),
    }),
    raw: true,
  });

  return transaction;
};

describe('Currency precision', () => {
  describe('regression guards (2-decimal currencies)', () => {
    it('stores a USD amount with extra decimals rounded half-up to 2 decimals', async () => {
      const account = await createAccountIn({ currencyCode: 'USD' });

      const transaction = await createTransactionOf({
        accountId: account.id,
        amount: 12.176673309,
      });

      expect(Number(transaction.amount)).toBe(12.18);
    });

    it('keeps a USD balance equal to the sum of its 2-decimal transactions', async () => {
      const account = await createAccountIn({ currencyCode: 'USD' });

      await createTransactionOf({ accountId: account.id, amount: 10.25 });
      await createTransactionOf({
        accountId: account.id,
        amount: 3.1,
        transactionType: TRANSACTION_TYPES.expense,
      });

      const updated = await helpers.getAccount({ id: account.id, raw: true });
      expect(Number(updated.currentBalance)).toBe(7.15);
    });
  });

  describe('storage keeps the currency decimals', () => {
    itPerCurrencyRounding('reads back a KWD transaction with 3 decimals', async () => {
      const account = await createAccountIn({ currencyCode: 'KWD' });

      const transaction = await createTransactionOf({
        accountId: account.id,
        amount: 1.234,
      });

      expect(Number(transaction.amount)).toBe(1.234);
    });

    itPerCurrencyRounding('keeps a KWD balance equal to the exact sum of its transactions', async () => {
      const account = await createAccountIn({ currencyCode: 'KWD' });

      await createTransactionOf({ accountId: account.id, amount: 1.234 });
      await createTransactionOf({
        accountId: account.id,
        amount: 0.111,
        transactionType: TRANSACTION_TYPES.expense,
      });
      await createTransactionOf({ accountId: account.id, amount: 2.005 });

      const updated = await helpers.getAccount({ id: account.id, raw: true });
      expect(Number(updated.currentBalance)).toBe(3.128);
    });
  });

  describe('rounding follows the currency decimals', () => {
    itPerCurrencyRounding('rounds a JPY amount to whole units', async () => {
      const account = await createAccountIn({ currencyCode: 'JPY' });

      const transaction = await createTransactionOf({
        accountId: account.id,
        amount: 1500.6,
      });

      expect(Number(transaction.amount)).toBe(1501);
    });

    itPerCurrencyRounding(
      'rounds a converted refAmount half-even to the 3 decimals of a KWD base currency',
      async () => {
        // KWD is not a supported base-currency change target, so the user starts with it.
        const kwdUser = await helpers.provisionSecondUserWithBaseCurrency({
          currencyCode: 'KWD',
        });

        await helpers.asUser({
          cookies: kwdUser.cookies,
          fn: async () => {
            const account = await createAccountIn({ currencyCode: 'JPY' });
            // The suite-wide default category belongs to the primary user.
            const category = await helpers.addCustomCategory({
              name: 'Precision',
              color: '#AABBCC',
              raw: true,
            });
            await helpers.updateUserCurrency({
              currency: { currencyCode: 'JPY', liveRateUpdate: false },
              raw: true,
            });
            await helpers.editCurrencyExchangeRate({
              pairs: [
                { baseCode: 'JPY', quoteCode: 'KWD', rate: 0.0005 },
                { baseCode: 'KWD', quoteCode: 'JPY', rate: 2000 },
              ],
            });

            // 5 JPY and 15 JPY convert to exact ties (0.0025 and 0.0075 KWD).
            const evenDown = await createTransactionOf({
              accountId: account.id,
              amount: 5,
              categoryId: category.id,
            });
            const evenUp = await createTransactionOf({
              accountId: account.id,
              amount: 15,
              categoryId: category.id,
            });

            expect(Number(evenDown.refAmount)).toBe(0.002);
            expect(Number(evenUp.refAmount)).toBe(0.008);
          },
        });
      },
    );
  });
});
