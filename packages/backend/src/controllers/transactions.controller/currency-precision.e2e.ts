import { type RecordId, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES, asDecimal } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { connection } from '@models/connection';
import * as helpers from '@tests/helpers';

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
  describe('storage and rounding follow the currency decimals', () => {
    it.each([
      { currencyCode: 'USD', amount: 12.176673309, expected: 12.18 },
      { currencyCode: 'KWD', amount: 1.234, expected: 1.234 },
      { currencyCode: 'JPY', amount: 1500.6, expected: 1501 },
    ])('stores a $currencyCode amount of $amount as $expected', async ({ currencyCode, amount, expected }) => {
      const account = await helpers.createAccountIn({ currencyCode });

      const transaction = await createTransactionOf({ accountId: account.id, amount });

      expect(Number(transaction.amount)).toBe(expected);
    });

    it('keeps a KWD balance equal to the exact sum of its transactions', async () => {
      const account = await helpers.createAccountIn({ currencyCode: 'KWD' });

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

    it('rounds a converted refAmount half-even to the 3 decimals of a KWD base currency', async () => {
      // KWD is not a supported base-currency change target, so the user starts with it.
      await helpers.asNewUserWithBaseCurrency({
        currencyCode: 'KWD',
        fn: async () => {
          const account = await helpers.createAccountIn({ currencyCode: 'JPY' });
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
    });
  });
  describe('opening balance and credit limit', () => {
    it.each([
      { currencyCode: 'USD', initialBalance: 100.555, creditLimit: 500.555, expected: [100.56, 500.56] },
      { currencyCode: 'KWD', initialBalance: 100.555, creditLimit: 500.4567, expected: [100.555, 500.457] },
      { currencyCode: 'JPY', initialBalance: 100.5, creditLimit: 50000.5, expected: [101, 50001] },
    ])(
      'rounds a $currencyCode opening balance and credit limit to the currency decimals',
      async ({ currencyCode, initialBalance, creditLimit, expected: [expectedBalance, expectedCreditLimit] }) => {
        const account = await helpers.createAccountIn({ currencyCode, initialBalance, creditLimit });

        expect(Number(account.initialBalance)).toBe(expectedBalance);
        expect(Number(account.currentBalance)).toBe(expectedBalance);
        expect(Number(account.creditLimit)).toBe(expectedCreditLimit);
      },
    );

    it('rounds the target of a balance adjustment to the account currency', async () => {
      const account = await helpers.createAccountIn({ currencyCode: 'KWD', initialBalance: 10 });

      await helpers.balanceAdjustment({ id: account.id, payload: { targetBalance: asDecimal(12.3456) }, raw: true });

      const updated = await helpers.getAccount({ id: account.id, raw: true });
      expect(Number(updated.currentBalance)).toBe(12.346);
    });
  });

  describe('transfers between currencies of different decimals', () => {
    it('rounds each leg to its own currency and keeps the balances exact', async () => {
      const jpyAccount = await helpers.createAccountIn({ currencyCode: 'JPY', initialBalance: 10000 });
      const kwdAccount = await helpers.createAccountIn({ currencyCode: 'KWD' });
      await helpers.updateUserCurrency({ currency: { currencyCode: 'JPY', liveRateUpdate: false }, raw: true });
      await helpers.updateUserCurrency({ currency: { currencyCode: 'KWD', liveRateUpdate: false }, raw: true });
      await helpers.editCurrencyExchangeRate({
        pairs: [
          { baseCode: 'JPY', quoteCode: global.BASE_CURRENCY.code, rate: 0.0065 },
          { baseCode: global.BASE_CURRENCY.code, quoteCode: 'JPY', rate: 153.84615 },
          { baseCode: 'KWD', quoteCode: global.BASE_CURRENCY.code, rate: 3.25 },
          { baseCode: global.BASE_CURRENCY.code, quoteCode: 'KWD', rate: 0.30769 },
        ],
      });

      const [outLeg, inLeg] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: jpyAccount.id,
            amount: 1500.6,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAmount: 3.4567,
          destinationAccountId: kwdAccount.id,
        },
        raw: true,
      });

      expect(Number(outLeg.amount)).toBe(1501);
      expect(Number(inLeg!.amount)).toBe(3.457);
      // 1501 * 0.0065 = 9.7565 and 3.457 * 3.25 = 11.23525: base-currency amounts carry 2 decimals
      expect(Number(outLeg.refAmount)).toBe(9.76);
      expect(Number(inLeg!.refAmount)).toBe(11.24);

      expect(Number((await helpers.getAccount({ id: jpyAccount.id, raw: true })).currentBalance)).toBe(8499);
      expect(Number((await helpers.getAccount({ id: kwdAccount.id, raw: true })).currentBalance)).toBe(3.457);
    });
  });

  describe('splits', () => {
    it('compares the splits with the transaction at the currency decimals', async () => {
      const account = await helpers.createAccountIn({ currencyCode: 'KWD' });
      const categories = await helpers.getCategoriesList();

      // Unrounded, 5.0624 + 5.0624 = 10.1248 exceeds 10.1236; rounded, 5.062 + 5.062 fits 10.124.
      const response = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: categories[0]!.id,
          amount: 10.1236,
          splits: [
            { categoryId: categories[1]!.id, amount: 5.0624 },
            { categoryId: categories[2]!.id, amount: 5.0624 },
          ],
        }),
        raw: false,
      });
      expect(response.statusCode).toBe(200);

      const [stored] = (await helpers.getTransactions({ raw: true }))!;
      expect(Number(stored!.amount)).toBe(10.124);
      expect(stored!.splits!.map((split) => Number(split.amount))).toEqual([5.062, 5.062]);
    });

    it('rejects splits that still exceed the transaction after rounding', async () => {
      const account = await helpers.createAccountIn({ currencyCode: 'JPY' });
      const categories = await helpers.getCategoriesList();

      const response = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: categories[0]!.id,
          amount: 100,
          splits: [
            { categoryId: categories[1]!.id, amount: 50.6 },
            { categoryId: categories[2]!.id, amount: 50.6 },
          ],
        }),
        raw: false,
      });

      // 50.6 rounds to 51 yen, and 51 + 51 exceeds 100
      expect(response.statusCode).toBe(422);
    });

    it('accepts splits that fit the transaction unrounded and keeps their rounded sum within it', async () => {
      const account = await helpers.createAccountIn({ currencyCode: 'JPY' });
      const categories = await helpers.getCategoriesList();

      // 500.5 + 499.5 fits 1000, but rounds half-up to 501 + 500.
      const response = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: categories[0]!.id,
          amount: 1000,
          splits: [
            { categoryId: categories[1]!.id, amount: 500.5 },
            { categoryId: categories[2]!.id, amount: 499.5 },
          ],
        }),
        raw: false,
      });
      expect(response.statusCode).toBe(200);

      const [stored] = (await helpers.getTransactions({ raw: true }))!;
      const splitAmounts = stored!.splits!.map((split) => Number(split.amount));
      expect(splitAmounts.every(Number.isInteger)).toBe(true);
      expect(splitAmounts.reduce((sum, amount) => sum + amount, 0)).toBe(1000);
    });
  });

  describe('same-currency reference amount', () => {
    it('keeps the reference amount of a base-currency portfolio transfer equal to the rounded amount', async () => {
      const account = await helpers.createAccountIn({ currencyCode: global.BASE_CURRENCY.code });
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Precision' }),
        raw: true,
      });

      // Half-even on the reference amount alone would give 1.00 next to a native 1.01.
      const transfer = await helpers.accountToPortfolioTransfer({
        portfolioId: portfolio.id,
        payload: { accountId: account.id, amount: '1.005', date: '2025-06-15' },
        raw: true,
      });

      const transaction = (await helpers.getTransactions({ raw: true })).find((tx) => tx.id === transfer.transactionId);
      expect(Number(transaction!.amount)).toBe(1.01);
      expect(Number(transaction!.refAmount)).toBe(1.01);
    });
  });

  describe('metadata-only edits', () => {
    it('keeps a stored amount that has more decimals than its currency, and the balance, untouched', async () => {
      const account = await helpers.createAccountIn({ currencyCode: 'JPY' });
      await helpers.updateUserCurrency({ currency: { currencyCode: 'JPY', liveRateUpdate: false }, raw: true });
      await helpers.editCurrencyExchangeRate({
        pairs: [
          { baseCode: 'JPY', quoteCode: global.BASE_CURRENCY.code, rate: 0.0065 },
          { baseCode: global.BASE_CURRENCY.code, quoteCode: 'JPY', rate: 153.84615 },
        ],
      });
      const transaction = await createTransactionOf({ accountId: account.id, amount: 10 });

      // A row migrated from 1050 cents holds 10.50 in a currency without minor units.
      await connection.sequelize.query(`UPDATE "Transactions" SET "amount" = 10.5 WHERE "id" = :id`, {
        replacements: { id: transaction!.id },
      });
      await connection.sequelize.query(`UPDATE "Accounts" SET "currentBalance" = 10.5 WHERE "id" = :id`, {
        replacements: { id: account.id },
      });

      const [updated] = await helpers.updateTransaction({
        id: transaction!.id,
        payload: { note: 'only the note' },
        raw: true,
      });

      expect(updated.note).toBe('only the note');
      expect(Number(updated.amount)).toBe(10.5);
      expect(Number((await helpers.getAccount({ id: account.id, raw: true })).currentBalance)).toBe(10.5);
    });

    it('still rounds an amount that the edit changes', async () => {
      const account = await helpers.createAccountIn({ currencyCode: 'JPY' });
      const transaction = await createTransactionOf({ accountId: account.id, amount: 10 });

      const [updated] = await helpers.updateTransaction({
        id: transaction!.id,
        payload: { amount: 20.5 },
        raw: true,
      });

      expect(Number(updated.amount)).toBe(21);
    });
  });
  describe('a positive amount that rounds to zero', () => {
    const createUsdToJpyTransfer = async ({ destinationAmount }: { destinationAmount: number }) => {
      const usdAccount = await helpers.createAccountIn({ currencyCode: 'USD', initialBalance: 100 });
      const jpyAccount = await helpers.createAccountIn({ currencyCode: 'JPY' });

      const response = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: usdAccount.id,
            amount: 10,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAmount,
          destinationAccountId: jpyAccount.id,
        },
      });

      return { response, usdAccount, jpyAccount };
    };

    it('rejects a transfer whose destination amount rounds to zero in its currency', async () => {
      const { response, jpyAccount } = await createUsdToJpyTransfer({ destinationAmount: 0.4 });

      expect(response.statusCode).toBe(422);
      expect(await helpers.getTransactions({ raw: true })).toHaveLength(0);
      expect(Number((await helpers.getAccount({ id: jpyAccount.id, raw: true })).currentBalance)).toBe(0);
    });

    it('rejects a transfer edit whose destination amount rounds to zero, leaving the leg as it was', async () => {
      const { response, usdAccount, jpyAccount } = await createUsdToJpyTransfer({ destinationAmount: 1500 });
      expect(response.statusCode).toBe(200);
      const outLeg = (await helpers.getTransactions({ raw: true })).find((tx) => tx.accountId === usdAccount.id)!;

      const edit = await helpers.updateTransaction({ id: outLeg.id, payload: { destinationAmount: 0.4 } });

      expect(edit.statusCode).toBe(422);
      expect(Number((await helpers.getAccount({ id: jpyAccount.id, raw: true })).currentBalance)).toBe(1500);
    });
  });

  describe('account edits', () => {
    /** A 0-decimal account as the decimal migration leaves it, from 100040 cents: a sub-unit digit on each balance. */
    const createMigratedJpyAccount = async () => {
      const account = await helpers.createAccountIn({ currencyCode: 'JPY', initialBalance: 1000 });
      await connection.sequelize.query(
        `UPDATE "Accounts" SET "initialBalance" = 1000.4, "currentBalance" = 1000.4 WHERE "id" = :id`,
        { replacements: { id: account.id } },
      );
      return account;
    };

    it('keeps a stored opening balance that has more decimals than its currency on a rename', async () => {
      const account = await createMigratedJpyAccount();

      await helpers.updateAccount({ id: account.id, payload: { name: 'Renamed' }, raw: true });

      const updated = await helpers.getAccount({ id: account.id, raw: true });
      expect(updated.name).toBe('Renamed');
      expect(Number(updated.initialBalance)).toBe(1000.4);
      expect(Number(updated.currentBalance)).toBe(1000.4);
    });

    it.each([
      { currencyCode: 'KWD', currentBalance: 12.3456, creditLimit: 500.0005, expected: [12.346, 500.001] },
      { currencyCode: 'JPY', currentBalance: 1500.5, creditLimit: 20000.4, expected: [1501, 20000] },
    ])(
      'rounds an edited $currencyCode balance and credit limit to the currency decimals',
      async ({ currencyCode, currentBalance, creditLimit, expected: [expectedBalance, expectedCreditLimit] }) => {
        const account = await helpers.createAccountIn({ currencyCode, initialBalance: 10 });

        await helpers.updateAccount({ id: account.id, payload: { currentBalance, creditLimit }, raw: true });

        const updated = await helpers.getAccount({ id: account.id, raw: true });
        expect(Number(updated.currentBalance)).toBe(expectedBalance);
        expect(Number(updated.initialBalance)).toBe(expectedBalance);
        expect(Number(updated.creditLimit)).toBe(expectedCreditLimit);
      },
    );

    it('reports the balance a balance adjustment leaves on a migrated account', async () => {
      const account = await createMigratedJpyAccount();

      const result = await helpers.balanceAdjustment({
        id: account.id,
        payload: { targetBalance: asDecimal(2000) },
        raw: true,
      });

      const stored = await helpers.getAccount({ id: account.id, raw: true });
      expect(result.newBalance).toBe(Number(stored.currentBalance));
      expect(Number(result.transaction!.amount)).toBe(1000);
    });

    it('books no adjustment when the difference to the target rounds to zero', async () => {
      const account = await createMigratedJpyAccount();

      const result = await helpers.balanceAdjustment({
        id: account.id,
        payload: { targetBalance: asDecimal(1000) },
        raw: true,
      });

      expect(result.transaction).toBeNull();
      expect(await helpers.getTransactions({ raw: true })).toHaveLength(0);
      expect(Number((await helpers.getAccount({ id: account.id, raw: true })).currentBalance)).toBe(1000.4);
    });
  });
});
