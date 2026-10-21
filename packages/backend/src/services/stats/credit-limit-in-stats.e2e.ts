import { ACCOUNT_CATEGORIES, TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { format, subDays } from 'date-fns';

describe('[Stats] Credit limit in statistics', () => {
  describe('getTotalBalance with credit limit setting', () => {
    it('subtracts the credit limit only while the setting is on', async () => {
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({
          accountCategory: ACCOUNT_CATEGORIES.creditCard,
          initialBalance: 5000,
          creditLimit: 3000,
        }),
        raw: true,
      });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.income,
          time: new Date().toISOString(),
        }),
        raw: true,
      });

      const today = format(new Date(), 'yyyy-MM-dd');

      // Without the setting, total balance = currentBalance (initial balance + income).
      expect(await helpers.getTotalBalance({ date: today, raw: true })).toBe(5100);

      await helpers.updateUserSettings({
        raw: true,
        settings: { locale: 'en', includeCreditLimitInStats: true },
      });

      // 5100 - creditLimit (3000)
      expect(await helpers.getTotalBalance({ date: today, raw: true })).toBe(2100);

      await helpers.updateUserSettings({
        raw: true,
        settings: { locale: 'en', includeCreditLimitInStats: false },
      });

      expect(await helpers.getTotalBalance({ date: today, raw: true })).toBe(5100);
    }, 60_000);

    it('rejects a date that is not a real calendar date', async () => {
      const malformed = await helpers.getTotalBalance({ date: 'not-a-date' });

      expect(malformed.statusCode).toEqual(ERROR_CODES.ValidationError);
    });

    it('only subtracts credit limit for accounts with creditLimit > 0', async () => {
      await helpers.updateUserSettings({
        raw: true,
        settings: { locale: 'en', includeCreditLimitInStats: true },
      });

      // Account with credit limit
      const creditAccount = await helpers.createAccount({
        payload: helpers.buildAccountPayload({
          accountCategory: ACCOUNT_CATEGORIES.creditCard,
          initialBalance: 5000,
          creditLimit: 3000,
        }),
        raw: true,
      });

      // Regular account without credit limit
      const regularAccount = await helpers.createAccount({
        payload: helpers.buildAccountPayload({
          accountCategory: ACCOUNT_CATEGORIES.general,
          initialBalance: 2000,
          creditLimit: 0,
        }),
        raw: true,
      });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: creditAccount.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.income,
          time: new Date().toISOString(),
        }),
        raw: true,
      });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: regularAccount.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.income,
          time: new Date().toISOString(),
        }),
        raw: true,
      });

      const today = format(new Date(), 'yyyy-MM-dd');
      const totalBalance = await helpers.getTotalBalance({ date: today, raw: true });

      // creditAccount: 5100 - 3000 = 2100
      // regularAccount: 2100 (no credit limit to subtract)
      // Total: 4200
      expect(totalBalance).toBe(4200);
    });

    it('respects excludeFromStats for credit limit accounts', async () => {
      await helpers.updateUserSettings({
        raw: true,
        settings: { locale: 'en', includeCreditLimitInStats: true },
      });

      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({
          accountCategory: ACCOUNT_CATEGORIES.creditCard,
          initialBalance: 5000,
          creditLimit: 3000,
        }),
        raw: true,
      });

      // Exclude from stats
      await helpers.updateAccount({
        id: account.id,
        payload: { excludeFromStats: true },
        raw: true,
      });

      const today = format(new Date(), 'yyyy-MM-dd');
      const totalBalance = await helpers.getTotalBalance({ date: today, raw: true });

      // Excluded accounts contribute neither balance nor credit limit adjustment
      expect(totalBalance).toBe(0);
    });

    it('uses refCreditLimit (base currency) for non-base-currency accounts', async () => {
      await helpers.updateUserSettings({
        raw: true,
        settings: { locale: 'en', includeCreditLimitInStats: true },
      });

      // Create a foreign currency account with a credit limit set at creation
      const { account } = await helpers.createAccountWithNewCurrency({
        currency: 'EUR',
      });

      // Update the account to have a credit limit
      await helpers.updateAccount({
        id: account.id,
        payload: { creditLimit: 1000 },
        raw: true,
      });

      // Re-fetch account to get updated refCreditLimit
      const updatedAccount = await helpers.getAccount({ id: account.id, raw: true });

      const today = format(new Date(), 'yyyy-MM-dd');
      const totalBalance = await helpers.getTotalBalance({ date: today, raw: true });

      // Credit limit doesn't affect balance, so refCurrentBalance stays at 0 (initial).
      // Stats should subtract refCreditLimit (base currency), not creditLimit (EUR).
      const refLimit = Number(updatedAccount.refCreditLimit);
      expect(refLimit).toBeGreaterThan(0);
      // totalBalance = balance record (refInitialBalance=0) - refCreditLimit
      expect(totalBalance).toBe(0 - refLimit);
    });
  });

  describe('getCombinedBalanceHistory with credit limit setting', () => {
    it('reports raw balances by default, then subtracts every account credit limit once the setting is on', async () => {
      const fromDate = format(subDays(new Date(), 7), 'yyyy-MM-dd');
      const toDate = format(new Date(), 'yyyy-MM-dd');

      await helpers.createAccount({
        payload: helpers.buildAccountPayload({
          accountCategory: ACCOUNT_CATEGORIES.creditCard,
          initialBalance: 5000,
          creditLimit: 3000,
        }),
        raw: true,
      });

      const rawData = await helpers.getCombinedBalanceHistory({ from: fromDate, to: toDate, raw: true });

      expect(rawData.length).toBeGreaterThan(0);
      const rawLastEntry = rawData[rawData.length - 1]!;
      expect(rawLastEntry.accountsBalance).toBe(5000);
      expect(rawLastEntry.totalBalance).toBe(5000);

      await helpers.updateUserSettings({
        raw: true,
        settings: { locale: 'en', includeCreditLimitInStats: true },
      });

      const adjustedData = await helpers.getCombinedBalanceHistory({ from: fromDate, to: toDate, raw: true });

      expect(adjustedData.length).toBeGreaterThan(0);
      for (const entry of adjustedData) {
        expect(entry.accountsBalance).toBe(2000); // 5000 - 3000
        expect(entry.totalBalance).toBe(2000);
      }

      await helpers.createAccount({
        payload: helpers.buildAccountPayload({
          accountCategory: ACCOUNT_CATEGORIES.creditCard,
          initialBalance: 2000,
          creditLimit: 1000,
        }),
        raw: true,
      });

      const multiAccountData = await helpers.getCombinedBalanceHistory({ from: fromDate, to: toDate, raw: true });

      // Account 1: 5000 - 3000 = 2000, Account 2: 2000 - 1000 = 1000, Total: 3000
      const multiAccountLastEntry = multiAccountData[multiAccountData.length - 1]!;
      expect(multiAccountLastEntry.accountsBalance).toBe(3000);
      expect(multiAccountLastEntry.totalBalance).toBe(3000);
    }, 60_000);

    it('excludes both balance and credit limit for excludeFromStats accounts', async () => {
      await helpers.updateUserSettings({
        raw: true,
        settings: { locale: 'en', includeCreditLimitInStats: true },
      });

      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({
          accountCategory: ACCOUNT_CATEGORIES.creditCard,
          initialBalance: 5000,
          creditLimit: 3000,
        }),
        raw: true,
      });

      // Exclude from stats
      await helpers.updateAccount({
        id: account.id,
        payload: { excludeFromStats: true },
        raw: true,
      });

      const fromDate = format(subDays(new Date(), 7), 'yyyy-MM-dd');
      const toDate = format(new Date(), 'yyyy-MM-dd');

      const data = await helpers.getCombinedBalanceHistory({
        from: fromDate,
        to: toDate,
        raw: true,
      });

      // Excluded account contributes neither balance nor credit limit adjustment
      // With no other accounts, the combined history should be empty
      expect(data).toEqual([]);
    });
  });
});

describe('[Stats] Loans in net worth', () => {
  it('subtracts a loan balance from the total and follows the excludeFromStats flag both ways', async () => {
    const today = format(new Date(), 'yyyy-MM-dd');

    await helpers.createAccount({
      payload: helpers.buildAccountPayload({ initialBalance: 10_000 }),
      raw: true,
    });

    expect(await helpers.getTotalBalance({ date: today, raw: true })).toBe(10_000);

    // Loans default to USD; pinning the currency to the base one keeps every refAmount
    // assertion in a single unit.
    const loan = await helpers.createLoan({
      payload: helpers.buildCreateLoanPayload({
        currencyCode: global.BASE_CURRENCY.code,
        initialBalance: 200_000,
      }),
      raw: true,
    });

    expect(await helpers.getTotalBalance({ date: today, raw: true })).toBe(-190_000);

    await helpers.updateAccount({
      id: loan.id,
      payload: { excludeFromStats: true },
      raw: true,
    });

    expect(await helpers.getTotalBalance({ date: today, raw: true })).toBe(10_000);

    await helpers.updateAccount({
      id: loan.id,
      payload: { excludeFromStats: false },
      raw: true,
    });

    expect(await helpers.getTotalBalance({ date: today, raw: true })).toBe(-190_000);
  }, 60_000);
});

describe('[Stats] getNetWorthHistory with credit limit setting', () => {
  it('nets each card balance against its own limit before classifying it, matching the combined history total', async () => {
    const fromDate = format(subDays(new Date(), 7), 'yyyy-MM-dd');
    const toDate = format(new Date(), 'yyyy-MM-dd');

    // Card A ends up owing (1000 - 3000), card B stays in surplus (5000 - 1000):
    // an aggregate subtraction would give the same net worth but not the same split.
    // The loan's limit must be ignored by both endpoints or their totals diverge.
    for (const payload of [
      { accountCategory: ACCOUNT_CATEGORIES.creditCard, initialBalance: 1000, creditLimit: 3000 },
      { accountCategory: ACCOUNT_CATEGORIES.creditCard, initialBalance: 5000, creditLimit: 1000 },
    ]) {
      await helpers.createAccount({ payload: helpers.buildAccountPayload(payload), raw: true });
    }
    const loan = await helpers.createLoan({
      payload: helpers.buildCreateLoanPayload({ currencyCode: global.BASE_CURRENCY.code, initialBalance: 2000 }),
      raw: true,
    });
    await helpers.updateAccount({ id: loan.id, payload: { creditLimit: 500 }, raw: true });

    const rawHistory = await helpers.getNetWorthHistory({
      from: fromDate,
      to: toDate,
      granularity: 'weekly',
      raw: true,
    });
    const rawLast = rawHistory.points[rawHistory.points.length - 1]!;
    expect(rawLast.assets.cash).toBe(6000);
    expect(rawLast.liabilities[ACCOUNT_CATEGORIES.creditCard]).toBe(0);
    expect(rawLast.liabilities[ACCOUNT_CATEGORIES.loan]).toBe(-2000);
    expect(rawLast.netWorth).toBe(4000);

    await helpers.updateUserSettings({
      raw: true,
      settings: { locale: 'en', includeCreditLimitInStats: true },
    });

    const adjusted = await helpers.getNetWorthHistory({ from: fromDate, to: toDate, granularity: 'weekly', raw: true });
    const adjustedLast = adjusted.points[adjusted.points.length - 1]!;
    expect(adjustedLast.assets.cash).toBe(4000);
    expect(adjustedLast.liabilities[ACCOUNT_CATEGORIES.creditCard]).toBe(-2000);
    expect(adjustedLast.liabilities[ACCOUNT_CATEGORIES.loan]).toBe(-2000);
    expect(adjustedLast.netWorth).toBe(0);

    const combined = await helpers.getCombinedBalanceHistory({ from: fromDate, to: toDate, raw: true });
    expect(combined[combined.length - 1]!.totalBalance).toBe(adjustedLast.netWorth);
  }, 60_000);
});
