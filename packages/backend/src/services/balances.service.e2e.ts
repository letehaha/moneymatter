import { TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import Balances from '@models/balances.model';
import Currencies from '@models/currencies.model';
import Transactions from '@models/transactions.model';
import * as helpers from '@tests/helpers';
import { addDays, addMonths, format, startOfDay, startOfMonth, subDays } from 'date-fns';

const callGetBalanceHistory = async (accountId, raw = false) => {
  const result = await helpers.makeRequest({
    method: 'get',
    url: '/stats/balance-history',
    payload: {
      accountId,
    },
  });

  return raw ? helpers.extractResponse(result) : result;
};
const callGelFullBalanceHistory = async (raw = false) => {
  const result = await helpers.makeRequest({
    method: 'get',
    url: '/stats/balance-history',
  });

  return raw ? helpers.extractResponse(result) : result;
};

describe('Balances service', () => {
  describe('the balances history table correctly updated when:', () => {
    const buildAccount = async ({
      accountInitialBalance = 0,
      currencyCode = null,
    }: {
      accountInitialBalance?: number;
      currencyCode?: string | null;
    } = {}) => {
      let newCurrency: Currencies | undefined = undefined;
      let currencyRate = 1;

      if (currencyCode) {
        newCurrency = global.MODELS_CURRENCIES!.find((item) => item.code === currencyCode);
        await helpers.addUserCurrencies({ currencyCodes: [currencyCode] });
        currencyRate = (await helpers.getCurrenciesRates({ codes: ['UAH'] }))[0]!.rate;
      }

      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({
          currencyCode: newCurrency?.code || global.BASE_CURRENCY.code,
          initialBalance: accountInitialBalance,
          currentBalance: accountInitialBalance,
        }),
        raw: true,
      });

      expect(account.initialBalance).toBe(accountInitialBalance);
      expect(account.refInitialBalance).toEqualRefValue(accountInitialBalance * currencyRate);

      // Note: account fields from HTTP response are serialized to numbers, but typed as Money.
      // Use Number() to bridge the type gap for arithmetic operations.
      const expense = helpers.buildTransactionPayload({
        accountId: account.id,
      });
      const income = helpers.buildTransactionPayload({
        accountId: account.id,
        transactionType: TRANSACTION_TYPES.income,
      });
      const initialBalancesHistory = await callGetBalanceHistory(account.id);

      expect(initialBalancesHistory.statusCode).toEqual(200);
      expect(helpers.extractResponse(initialBalancesHistory).length).toEqual(1);
      expect(helpers.extractResponse(initialBalancesHistory)[0].amount).toEqualRefValue(
        Number(account.currentBalance) * currencyRate,
      );

      return {
        accountData: account,
        currencyRate,
        expense,
        income,
      };
    };

    it('– adding transactions at the same date', async () => {
      const { accountData, expense, income } = await buildAccount();

      for (const type of [expense, expense, income]) {
        await helpers.createTransaction({ payload: type });
      }

      const finalBalancesHistory = await callGetBalanceHistory(accountData.id);

      expect(finalBalancesHistory.statusCode).toEqual(200);
      expect(helpers.extractResponse(finalBalancesHistory).length).toEqual(2);
      expect(helpers.extractResponse(finalBalancesHistory)[0].amount).toEqual(Number(accountData.initialBalance));
      expect(helpers.extractResponse(finalBalancesHistory)[1].amount).toEqual(
        // since we have 2 expenses and 1 income, we can check for 1 expense
        Number(accountData.currentBalance) - expense.amount,
      );
    });

    it(`[testing account's initialBalance]
      – creating account with custom amount
      – adding transaction for the next date
      – and then adding transaction for the prior account creation date
    `, async () => {
      const { accountData, expense, income } = await buildAccount({
        accountInitialBalance: 1000,
      });

      // Firstly create a transaction AFTER account creation date
      await helpers.createTransaction({
        payload: {
          ...expense,
          time: startOfDay(addDays(new Date(), 1)).toISOString(),
        },
      });

      const afterBalance = await callGetBalanceHistory(accountData.id, true);

      expect(afterBalance.length).toBe(2);
      expect(afterBalance.at(0).amount).toBe(Number(accountData.initialBalance));
      expect(afterBalance.at(1).amount).toBe(Number(accountData.initialBalance) - expense.amount);

      // Then create a transaction BEFORE account creation date
      await helpers.createTransaction({
        payload: {
          ...income,
          time: startOfDay(subDays(new Date(), 1)).toISOString(),
        },
      });

      const beforeBalance = await callGetBalanceHistory(accountData.id, true);

      expect(beforeBalance.length).toBe(4);
      expect(beforeBalance.at(0).amount).toBe(Number(accountData.initialBalance));
      expect(beforeBalance.at(1).amount).toBe(Number(accountData.initialBalance) + income.amount);
      expect(beforeBalance.at(2).amount).toBe(Number(accountData.initialBalance) + income.amount);
      expect(beforeBalance.at(3).amount).toBe(Number(accountData.initialBalance) - expense.amount + income.amount);
    });

    it(`[testing account's initialBalance with transaction at that date]
      – creating account with custom amount
      – addin transaction for account creation date
      – adding transaction for the next date
      – and then adding transaction for the prior account creation date
    `, async () => {
      const { accountData, expense, income } = await buildAccount({
        accountInitialBalance: 1000,
      });

      // Firstly create a transaction AFTER account creation date
      await helpers.createTransaction({
        payload: {
          ...expense,
          time: startOfDay(addDays(new Date(), 1)).toISOString(),
        },
      });

      // Add transaction for the same day
      await helpers.createTransaction({
        payload: {
          ...income,
          time: startOfDay(new Date()).toISOString(),
        },
      });

      const afterBalance = await callGetBalanceHistory(accountData.id, true);

      expect(afterBalance.length).toBe(3);
      expect(afterBalance.at(0).amount).toBe(Number(accountData.initialBalance));
      expect(afterBalance.at(1).amount).toBe(Number(accountData.initialBalance) + income.amount);
      expect(afterBalance.at(2).amount).toBe(Number(accountData.initialBalance) - expense.amount + income.amount);

      // Then create a transaction BEFORE account creation date
      await helpers.createTransaction({
        payload: {
          ...income,
          time: startOfDay(subDays(new Date(), 1)).toISOString(),
        },
      });

      const beforeBalance = await callGetBalanceHistory(accountData.id, true);

      expect(beforeBalance.length).toBe(4);
      expect(beforeBalance.at(0).amount).toBe(Number(accountData.initialBalance));
      expect(beforeBalance.at(1).amount).toBe(Number(accountData.initialBalance) + income.amount);
      expect(beforeBalance.at(2).amount).toBe(Number(accountData.initialBalance) + income.amount + income.amount);
      expect(beforeBalance.at(3).amount).toBe(
        Number(accountData.initialBalance) - expense.amount + income.amount + income.amount,
      );
    });

    it('deleting transaction', async () => {
      const { accountData, expense, income } = await buildAccount({
        accountInitialBalance: 1000,
      });

      const transactionsPayloads = [
        { ...expense, time: startOfDay(addDays(new Date(), 1)) },
        { ...income, time: startOfDay(new Date()) },
        { ...income, time: startOfDay(subDays(new Date(), 1)) },
      ];
      const transactionResults: Transactions[] = [];

      // Send 3 transactions at different days
      for (const tx of transactionsPayloads) {
        const response = await helpers.createTransaction({
          payload: {
            ...tx,
            time: tx.time.toISOString(),
          },
          raw: true,
        });
        transactionResults.push(response[0]);
      }

      // Delete them
      for (const result of transactionResults.flat()) {
        await helpers.makeRequest({
          method: 'delete',
          url: `/transactions/${result.id}`,
        });
      }

      const finalBalanceHistory: Balances[] = await callGetBalanceHistory(accountData.id, true);

      // Since we added transaction prior account creation, we will have +1 transaction
      expect(finalBalanceHistory.length).toBe(4);
      // Check that after removing all the transactions, the initial balance is set to correct
      expect(finalBalanceHistory.every((record) => Number(record.amount) === Number(accountData.initialBalance))).toBe(
        true,
      );
    });

    const mockBalanceHistory = async () => {
      const { accountData, expense, income } = await buildAccount({
        accountInitialBalance: 1000,
      });

      // Add record for account creation date, 2 days after and 2 days before
      const transactionsPayloads = [
        { ...expense, amount: 50, time: startOfDay(subDays(new Date(), 2)) },
        { ...income, amount: 200, time: startOfDay(subDays(new Date(), 1)) },
        { ...expense, amount: 100, time: startOfDay(addDays(new Date(), 1)) },
        { ...expense, amount: 50, time: startOfDay(addDays(new Date(), 2)) },
        { ...income, amount: 150, time: new Date() },
      ];
      const transactionResults: Transactions[] = [];

      for (const tx of transactionsPayloads) {
        const response = await helpers.createTransaction({
          payload: {
            ...tx,
            time: tx.time.toISOString(),
          },
          raw: true,
        });

        if (response) transactionResults.push(...(response as Transactions[]));
      }

      const balanceHistory: Balances[] = await callGetBalanceHistory(accountData.id, true);

      expect(balanceHistory).toStrictEqual([
        // Since we added transaction BEFORE account creation, we will always
        // have +1 record to represent initialBalance
        {
          date: format(subDays(new Date(), 3), 'yyyy-MM-dd'),
          amount: accountData.initialBalance,
        },
        { date: format(subDays(new Date(), 2), 'yyyy-MM-dd'), amount: 950 },
        { date: format(subDays(new Date(), 1), 'yyyy-MM-dd'), amount: 1150 },
        { date: format(new Date(), 'yyyy-MM-dd'), amount: 1300 },
        { date: format(addDays(new Date(), 1), 'yyyy-MM-dd'), amount: 1200 },
        { date: format(addDays(new Date(), 2), 'yyyy-MM-dd'), amount: 1150 },
      ]);

      return {
        accountData,
        balanceHistory,
        transactionResults,
      };
    };

    it('updating transaction amount [expense & income]', async () => {
      const { accountData, transactionResults } = await mockBalanceHistory();

      // Update expense transaction
      await helpers.updateTransaction({
        id: transactionResults[0]!.id,
        payload: { amount: 150 },
      });

      const newBalanceHistory1: Balances[] = await callGetBalanceHistory(accountData.id, true);

      expect(newBalanceHistory1).toStrictEqual([
        {
          date: format(subDays(new Date(), 3), 'yyyy-MM-dd'),
          amount: accountData.initialBalance,
        },
        { date: format(subDays(new Date(), 2), 'yyyy-MM-dd'), amount: 850 },
        { date: format(subDays(new Date(), 1), 'yyyy-MM-dd'), amount: 1050 },
        { date: format(new Date(), 'yyyy-MM-dd'), amount: 1200 },
        { date: format(addDays(new Date(), 1), 'yyyy-MM-dd'), amount: 1100 },
        { date: format(addDays(new Date(), 2), 'yyyy-MM-dd'), amount: 1050 },
      ]);

      // Update income transaction
      await helpers.updateTransaction({
        id: transactionResults[1]!.id,
        payload: { amount: 350 },
      });

      const newBalanceHistory2: Balances[] = await callGetBalanceHistory(accountData.id, true);

      expect(newBalanceHistory2).toStrictEqual([
        {
          date: format(subDays(new Date(), 3), 'yyyy-MM-dd'),
          amount: accountData.initialBalance,
        },
        { date: format(subDays(new Date(), 2), 'yyyy-MM-dd'), amount: 850 },
        { date: format(subDays(new Date(), 1), 'yyyy-MM-dd'), amount: 1200 },
        { date: format(new Date(), 'yyyy-MM-dd'), amount: 1350 },
        { date: format(addDays(new Date(), 1), 'yyyy-MM-dd'), amount: 1250 },
        { date: format(addDays(new Date(), 2), 'yyyy-MM-dd'), amount: 1200 },
      ]);
    });

    it('updating transaction amount, date, transactionType and accountId', async () => {
      const { accountData, transactionResults } = await mockBalanceHistory();

      const testDate = new Date();

      await helpers.updateTransaction({
        id: transactionResults[0]!.id,
        payload: {
          amount: 150,
          time: startOfDay(subDays(testDate, 4)).toISOString(),
          transactionType: TRANSACTION_TYPES.income,
        },
      });

      const newBalanceHistory1: Balances[] = await callGetBalanceHistory(accountData.id, true);

      expect(newBalanceHistory1).toStrictEqual([
        {
          date: format(subDays(testDate, 5), 'yyyy-MM-dd'),
          amount: accountData.initialBalance,
        },
        { date: format(subDays(testDate, 4), 'yyyy-MM-dd'), amount: 1150 },
        { date: format(subDays(testDate, 3), 'yyyy-MM-dd'), amount: 1150 },
        { date: format(subDays(testDate, 2), 'yyyy-MM-dd'), amount: 1150 },
        { date: format(subDays(testDate, 1), 'yyyy-MM-dd'), amount: 1350 },
        { date: format(testDate, 'yyyy-MM-dd'), amount: 1500 },
        { date: format(addDays(testDate, 1), 'yyyy-MM-dd'), amount: 1400 },
        { date: format(addDays(testDate, 2), 'yyyy-MM-dd'), amount: 1350 },
      ]);

      const { accountData: oneMoreAccountData } = await buildAccount({
        accountInitialBalance: 0,
      });

      // Update transaction for the next month.
      // Guard against landing on the 1st of a month, which would cause
      // startOfMonth(newAccountTxDate) to equal newAccountTxDate
      const baseDate = addDays(testDate, 5);
      const adjustedDate = baseDate.getDate() === 1 ? addDays(baseDate, 1) : baseDate;
      const newAccountTxDate = addMonths(startOfDay(adjustedDate), 1);

      await helpers.updateTransaction({
        id: transactionResults[3]!.id,
        payload: {
          amount: 150,
          time: newAccountTxDate.toISOString(),
          transactionType: TRANSACTION_TYPES.income,
          accountId: oneMoreAccountData.id,
        },
      });

      const newBalanceHistory2: Balances[] = await callGelFullBalanceHistory(true);

      // Yeah it looks really hard, but that's the way to verify everything is okay
      expect(newBalanceHistory2).toStrictEqual([
        {
          date: format(subDays(testDate, 5), 'yyyy-MM-dd'),
          amount: accountData.initialBalance,
          accountId: accountData.id,
        },
        {
          date: format(subDays(testDate, 4), 'yyyy-MM-dd'),
          amount: 1150,
          accountId: accountData.id,
        },
        {
          date: format(subDays(testDate, 3), 'yyyy-MM-dd'),
          amount: 1150,
          accountId: accountData.id,
        },
        {
          date: format(subDays(testDate, 2), 'yyyy-MM-dd'),
          amount: 1150,
          accountId: accountData.id,
        },
        {
          date: format(subDays(testDate, 1), 'yyyy-MM-dd'),
          amount: 1350,
          accountId: accountData.id,
        },
        {
          date: format(testDate, 'yyyy-MM-dd'),
          amount: 1500,
          accountId: accountData.id,
        },
        {
          date: format(testDate, 'yyyy-MM-dd'),
          amount: oneMoreAccountData.initialBalance,
          accountId: oneMoreAccountData.id,
        },
        {
          date: format(addDays(testDate, 1), 'yyyy-MM-dd'),
          amount: 1400,
          accountId: accountData.id,
        },
        {
          date: format(addDays(testDate, 2), 'yyyy-MM-dd'),
          amount: 1400,
          accountId: accountData.id,
        },
        // When updated transaction to the next month, also make sure that transaction
        // for the beginning of the month is added
        {
          date: format(startOfMonth(newAccountTxDate), 'yyyy-MM-dd'),
          amount: 0,
          accountId: oneMoreAccountData.id,
        },
        {
          date: format(newAccountTxDate, 'yyyy-MM-dd'),
          amount: 150,
          accountId: oneMoreAccountData.id,
        },
      ]);
    });

    it("updating account's balance directly, without transactions", async () => {
      const initialBalance = 10000;
      const { accountData, currencyRate } = await buildAccount({
        accountInitialBalance: initialBalance,
        currencyCode: 'UAH',
      });

      const initialHistory = helpers.extractResponse(await callGetBalanceHistory(accountData.id));

      expect(initialHistory[0].amount).toEqualRefValue(initialBalance * currencyRate);

      // Firstly test that balance increase works well
      await helpers.updateAccount({
        id: accountData.id,
        payload: {
          currentBalance: initialBalance + 5000,
        },
      });

      const historyIncreaseChange = helpers.extractResponse(await callGetBalanceHistory(accountData.id));

      historyIncreaseChange.forEach((item) => {
        expect(item.amount).toBeCloseTo(Math.floor((initialBalance + 5000) * currencyRate) - 1, -1);
      });

      // Then test that balance decreate works well
      await helpers.updateAccount({
        id: accountData.id,
        payload: {
          currentBalance: 0,
        },
      });

      const historyDecreaseChange = helpers.extractResponse(await callGetBalanceHistory(accountData.id));

      historyDecreaseChange.forEach((item) => {
        expect(item.amount).toBe(0);
      });
    });

    it("updating a transaction with the same amount shouldn't affect the balance", async () => {
      // Initial setup: create an account and transaction
      const initialBalance = 1000;
      const { accountData } = await buildAccount({
        accountInitialBalance: initialBalance,
      });

      // Create a transaction and verify the balance after the transaction
      const expenseAmount = 100;
      const transactionPayload = {
        ...helpers.buildTransactionPayload({ accountId: accountData.id }),
        amount: expenseAmount,
      };
      const transactionResponse = await helpers.createTransaction({
        payload: transactionPayload,
        raw: true,
      });
      const transactionId = transactionResponse[0].id;

      const initialHistory = helpers.extractResponse(await callGetBalanceHistory(accountData.id));
      expect(initialHistory.at(-1).amount).toBe(initialBalance - expenseAmount);

      // Update the transaction with the same amount
      await helpers.updateTransaction({
        id: transactionId,
        payload: { amount: expenseAmount },
      });

      // Verify the balance is unchanged
      const updatedHistory = helpers.extractResponse(await callGetBalanceHistory(accountData.id));
      expect(updatedHistory.at(-1).amount).toBe(initialBalance - expenseAmount);
    });
    it.todo('creation transfer transactions');
    it.todo('updating expense/income => transfer => expense/income');
  });
});
