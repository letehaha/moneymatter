import { type RecordId, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES, asDecimal } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { connection } from '@models/connection';
import * as helpers from '@tests/helpers';

const createAccountIn = async ({ currencyCode, initialBalance }: { currencyCode: string; initialBalance?: number }) => {
  await helpers.addUserCurrencies({ currencyCodes: [currencyCode], raw: true });

  return helpers.createAccount({
    payload: helpers.buildAccountPayload({ currencyCode, ...(initialBalance !== undefined && { initialBalance }) }),
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
    it('reads back a KWD transaction with 3 decimals', async () => {
      const account = await createAccountIn({ currencyCode: 'KWD' });

      const transaction = await createTransactionOf({
        accountId: account.id,
        amount: 1.234,
      });

      expect(Number(transaction.amount)).toBe(1.234);
    });

    it('keeps a KWD balance equal to the exact sum of its transactions', async () => {
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
    it('rounds a JPY amount to whole units', async () => {
      const account = await createAccountIn({ currencyCode: 'JPY' });

      const transaction = await createTransactionOf({
        accountId: account.id,
        amount: 1500.6,
      });

      expect(Number(transaction.amount)).toBe(1501);
    });

    it('rounds a converted refAmount half-even to the 3 decimals of a KWD base currency', async () => {
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
    });
  });
  describe('opening balance and credit limit', () => {
    it('stores a USD opening balance rounded half-up to 2 decimals', async () => {
      const account = await createAccountIn({ currencyCode: 'USD', initialBalance: 100.555 });

      expect(Number(account.initialBalance)).toBe(100.56);
      expect(Number(account.currentBalance)).toBe(100.56);
    });

    it('keeps the 3 decimals of a KWD opening balance', async () => {
      const account = await createAccountIn({ currencyCode: 'KWD', initialBalance: 100.555 });

      expect(Number(account.initialBalance)).toBe(100.555);
      expect(Number(account.currentBalance)).toBe(100.555);
    });

    it('rounds a JPY opening balance to whole units', async () => {
      const account = await createAccountIn({ currencyCode: 'JPY', initialBalance: 100.5 });

      expect(Number(account.initialBalance)).toBe(101);
    });

    it('rounds a KWD credit limit to 3 decimals and a JPY one to whole units', async () => {
      await helpers.addUserCurrencies({ currencyCodes: ['KWD', 'JPY'], raw: true });

      const kwd = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ currencyCode: 'KWD', creditLimit: 500.4567 }),
        raw: true,
      });
      const jpy = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ currencyCode: 'JPY', creditLimit: 50000.5 }),
        raw: true,
      });

      expect(Number(kwd.creditLimit)).toBe(500.457);
      expect(Number(jpy.creditLimit)).toBe(50001);
    });

    it('rounds the target of a balance adjustment to the account currency', async () => {
      const account = await createAccountIn({ currencyCode: 'KWD', initialBalance: 10 });

      await helpers.balanceAdjustment({ id: account.id, payload: { targetBalance: asDecimal(12.3456) }, raw: true });

      const updated = await helpers.getAccount({ id: account.id, raw: true });
      expect(Number(updated.currentBalance)).toBe(12.346);
    });
  });

  describe('transfers between currencies of different decimals', () => {
    it('rounds each leg to its own currency and keeps the balances exact', async () => {
      const jpyAccount = await createAccountIn({ currencyCode: 'JPY', initialBalance: 10000 });
      const kwdAccount = await createAccountIn({ currencyCode: 'KWD' });
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
      const account = await createAccountIn({ currencyCode: 'KWD' });
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

      const [stored] = (await helpers.getTransactions({ raw: true, includeSplits: true }))!;
      expect(Number(stored!.amount)).toBe(10.124);
      expect(stored!.splits!.map((split) => Number(split.amount))).toEqual([5.062, 5.062]);
    });

    it('rejects splits that still exceed the transaction after rounding', async () => {
      const account = await createAccountIn({ currencyCode: 'JPY' });
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
  });

  describe('same-currency reference amount', () => {
    it('keeps the reference amount of a base-currency portfolio transfer equal to the rounded amount', async () => {
      const account = await createAccountIn({ currencyCode: global.BASE_CURRENCY.code });
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
      const account = await createAccountIn({ currencyCode: 'JPY' });
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
      const account = await createAccountIn({ currencyCode: 'JPY' });
      const transaction = await createTransactionOf({ accountId: account.id, amount: 10 });

      const [updated] = await helpers.updateTransaction({
        id: transaction!.id,
        payload: { amount: 20.5 },
        raw: true,
      });

      expect(Number(updated.amount)).toBe(21);
    });
  });
});
