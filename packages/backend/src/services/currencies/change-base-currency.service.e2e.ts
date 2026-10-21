import { ACCOUNT_CATEGORIES, TRANSACTION_TYPES } from '@bt/shared/types';
import { INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types/investments';
import { Money } from '@common/types/money';
import { faker } from '@faker-js/faker';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import Accounts from '@models/accounts.model';
import Balances from '@models/balances.model';
import Holdings from '@models/investments/holdings.model';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import PortfolioBalances from '@models/investments/portfolio-balances.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Transactions from '@models/transactions.model';
import { redisClient } from '@root/redis-client';
import { calculateRefAmountFromParams } from '@services/calculate-ref-amount.service';
import { buildLockKey } from '@services/currencies/base-currency-lock';
import * as userExchangeRateService from '@services/user-exchange-rate';
import * as helpers from '@tests/helpers';

describe('Change Base Currency', () => {
  beforeEach(async () => {
    // Make base currency GBP
    await helpers.makeRequest({
      method: 'post',
      url: '/user/currencies/base',
      payload: { currencyCode: 'GBP' },
    });

    // Add USD currency since many conversions will be into this one currency
    await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
  });
  describe('POST /user/currencies/change-base', () => {
    it('rejects an unknown currency code and takes no lock', async () => {
      const { id: userId } = await helpers.getUserInfo({ raw: true });
      const res = await helpers.changeBaseCurrency({ newCurrencyCode: 'ZZZ' });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);

      // Validation runs before the enqueue that acquires the lock, so no lock key
      // may be left behind — otherwise the user would be blocked by a phantom change.
      const lock = await redisClient.get(buildLockKey(userId));
      expect(lock).toBeNull();
    });

    it('recalculates transactions, accounts and balance history while preserving nominal values', async () => {
      const [account, initialBalanceOnlyAccount] = await Promise.all([
        helpers.createAccount({
          payload: {
            name: 'EUR Account',
            currencyCode: 'EUR',
            initialBalance: 10000, // 100 EUR
            creditLimit: 50000, // 500 EUR credit limit
            accountCategory: ACCOUNT_CATEGORIES.general,
          },
          raw: true,
        }),
        helpers.createAccount({
          payload: {
            name: 'EUR Account with Initial Balance',
            currencyCode: 'EUR',
            initialBalance: 50000, // 500 EUR
            creditLimit: 0,
            accountCategory: ACCOUNT_CATEGORIES.general,
          },
          raw: true,
        }),
      ]);

      const commissionTxPayload = helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 2000,
        transactionType: TRANSACTION_TYPES.expense,
        time: new Date('2024-01-10').toISOString(),
      });

      const [[tx1], [tx2], [tx3]] = await Promise.all([
        helpers.createTransaction({
          payload: { ...commissionTxPayload, commissionRate: commissionTxPayload.amount / 2 },
          raw: true,
        }),
        helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 3000,
            transactionType: TRANSACTION_TYPES.income,
            time: new Date('2024-01-15').toISOString(),
          }),
          raw: true,
        }),
        helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 1000,
            transactionType: TRANSACTION_TYPES.expense,
            time: new Date('2024-01-20').toISOString(),
          }),
          raw: true,
        }),
      ]);
      const txIds = [tx1!.id, tx2!.id, tx3!.id];

      const [originalTxs, originalAccount, originalInitialBalanceOnlyAccount, balanceBeforeChange, historyBefore] =
        await Promise.all([
          Promise.all(txIds.map((id) => Transactions.findByPk(id, { raw: true }))),
          Accounts.findByPk(account.id),
          Accounts.findByPk(initialBalanceOnlyAccount.id),
          Balances.findOne({ where: { accountId: initialBalanceOnlyAccount.id } }),
          helpers.makeRequest({
            method: 'get',
            url: '/stats/balance-history',
            payload: { accountId: initialBalanceOnlyAccount.id },
          }),
        ]);

      expect(balanceBeforeChange).toBeDefined();
      expect(balanceBeforeChange!.amount).toEqual(originalInitialBalanceOnlyAccount!.refInitialBalance);

      const historyBeforeData = helpers.extractResponse(historyBefore);
      expect(historyBeforeData.length).toEqual(1);
      expect(historyBeforeData[0].amount).toEqual(initialBalanceOnlyAccount.refInitialBalance);

      const status = await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: 'USD' });
      helpers.expectBaseCurrencyChangeCompleted(status);
      expect(status.result.transactionsUpdated).toBeGreaterThan(0);
      expect(status.result.accountsUpdated).toBeGreaterThan(0);

      const newBaseCurrency = (await helpers.getUserCurrencies()).find((i) => i.isDefaultCurrency)!;
      expect(newBaseCurrency.currencyCode).toEqual('USD');
      expect(newBaseCurrency.isDefaultCurrency).toBe(true);

      const updatedTxs = await Promise.all(txIds.map((id) => Transactions.findByPk(id, { raw: true })));

      updatedTxs.forEach((updatedTx, index) => {
        const originalTx = originalTxs[index]!;
        expect(updatedTx!.amount).toEqual(originalTx.amount);
        expect(updatedTx!.currencyCode).toEqual(originalTx.currencyCode);
        expect(updatedTx!.refCurrencyCode).toEqual('USD');
        expect(updatedTx!.refAmount).not.toEqual(originalTx.refAmount);
      });

      expect(updatedTxs[0]!.commissionRate).toEqual(originalTxs[0]!.commissionRate);
      expect(updatedTxs[0]!.refCommissionRate).not.toEqual(originalTxs[0]!.refCommissionRate);

      const updatedAccount = await Accounts.findByPk(account.id);
      expect(updatedAccount!.creditLimit).toEqual(originalAccount!.creditLimit);
      expect(updatedAccount!.refCreditLimit).not.toEqual(originalAccount!.refCreditLimit);
      expect(updatedAccount!.refInitialBalance).toBeDefined();
      expect(updatedAccount!.refCurrentBalance).toBeDefined();

      const balancesAfter = await Balances.findAll({
        where: { accountId: account.id },
        order: [['date', 'ASC']],
      });
      expect(balancesAfter.length).toBeGreaterThan(0);
      for (let i = 1; i < balancesAfter.length; i++) {
        expect(new Date(balancesAfter[i]!.date).getTime()).toBeGreaterThanOrEqual(
          new Date(balancesAfter[i - 1]!.date).getTime(),
        );
      }

      const [updatedInitialBalanceOnlyAccount, balanceAfterChange, historyAfter, combinedHistory] = await Promise.all([
        Accounts.findByPk(initialBalanceOnlyAccount.id),
        Balances.findOne({ where: { accountId: initialBalanceOnlyAccount.id } }),
        helpers.makeRequest({
          method: 'get',
          url: '/stats/balance-history',
          payload: { accountId: initialBalanceOnlyAccount.id },
        }),
        helpers.makeRequest({
          method: 'get',
          url: '/stats/balance-history',
        }),
      ]);

      expect(updatedInitialBalanceOnlyAccount!.refInitialBalance).toBeDefined();
      expect(updatedInitialBalanceOnlyAccount!.refCurrentBalance).toBeDefined();

      expect(balanceAfterChange).toBeDefined();
      expect(balanceAfterChange!.amount.toNumber()).toBeGreaterThan(0);

      const historyAfterData = helpers.extractResponse(historyAfter);
      expect(historyAfterData.length).toBeGreaterThan(0);
      expect(historyAfterData[0].amount).toBeGreaterThan(0);

      const combinedData = helpers.extractResponse(combinedHistory);
      const accountBalances = combinedData.filter(
        (b: { accountId: string }) => b.accountId === initialBalanceOnlyAccount.id,
      );
      expect(accountBalances.length).toBeGreaterThan(0);
    }, 30000);

    it('should handle the complete recalculation of everything with a correct outcome', async () => {
      // Add currencies that will be used
      const { currencies } = await helpers.addUserCurrencies({ currencyCodes: ['UAH', 'EUR'], raw: true });

      // ========== STEP 1: Create accounts with different currencies ==========

      const uahCurrency = currencies.find((i) => i.currencyCode === 'UAH')!;
      const eurCurrency = currencies.find((i) => i.currencyCode === 'EUR')!;

      const accounts = await Promise.all(
        [uahCurrency.currencyCode, eurCurrency.currencyCode, 'USD'].map((currencyCode) =>
          helpers.createAccount({
            payload: {
              name: `${currencyCode} Account`,
              currencyCode: currencyCode,
              initialBalance: 100000,
              creditLimit: 50000,
              accountCategory: ACCOUNT_CATEGORIES.general,
            },
            raw: true,
          }),
        ),
      );
      const uahAccount = accounts[0]!;
      const eurAccount = accounts[1]!;
      const usdAccount = accounts[2]!;

      // ========== STEP 2: Create transactions for accounts ==========

      await Promise.all(
        accounts
          .map((account, index) =>
            Array.from({ length: 3 }).map(() =>
              helpers.createTransaction({
                payload: helpers.buildTransactionPayload({
                  accountId: account.id,
                  amount: faker.number.int({ min: 1000, max: 10000 }),
                  transactionType: index % 2 ? TRANSACTION_TYPES.expense : TRANSACTION_TYPES.income,
                  time: faker.date.between({ from: new Date('2024-01-10'), to: new Date('2024-10-10') }).toISOString(),
                }),
                raw: true,
              }),
            ),
          )
          .flat(),
      );

      // ========== STEP 3: Create investment portfolio and transactions ==========

      // Create portfolio
      const portfolio = await helpers.createPortfolio({
        payload: {
          name: 'Test Investment Portfolio',
        },
        raw: true,
      });

      // Seed securities
      const securities = await helpers.seedSecurities([
        { symbol: 'VOO', name: 'Vanguard S&P 500 ETF', currencyCode: 'USD' },
      ]);

      const vooSecurity = securities[0]!;

      // Create holding
      await helpers.createHolding({
        payload: {
          portfolioId: portfolio.id,
          securityId: vooSecurity.id,
        },
        raw: true,
      });

      // Create investment transaction (BUY)
      const investmentTx = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: vooSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: '2024-01-18',
          quantity: '10',
          price: '400', // $400 per share
          fees: '5', // $5 fees
        },
        raw: true,
      });

      // Update portfolio balance
      await helpers.updatePortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode: 'USD',
        setAvailableCash: '5000',
        setTotalCash: '5000',
        raw: true,
      });

      // Create portfolio transfer
      const transfer = await helpers.createPortfolioTransfer({
        fromPortfolioId: portfolio.id,
        payload: helpers.buildPortfolioTransferPayload({
          toPortfolioId: portfolio.id, // Self transfer for testing
          currencyCode: 'USD',
          amount: '1000',
          date: '2024-01-25',
        }),
        raw: true,
      });

      // ========== STEP 4: Store original ref values and calculate expected values for new base (USD) ==========

      // Get original values before currency change.
      // ORDER BY id keeps the row order stable across the pre/post snapshots so
      // the index-based comparisons below pair the same row to itself. Without
      // ORDER BY Postgres returns rows in whatever order it pleases – after the
      // UUID v7 PK migration, post-UPDATE row order no longer matches the
      // pre-UPDATE order, and the comparisons would line up different rows.
      const [
        originalUahTransactions,
        originalEurTransactions,
        originalUsdTransactions,
        originalUahAccount,
        originalEurAccount,
        originalUsdAccount,
        originalInvestmentTx,
        originalTransfer,
        originalPortfolioBalance,
      ] = await Promise.all([
        Transactions.findAll({ where: { accountId: uahAccount.id }, order: [['id', 'ASC']], raw: true }),
        Transactions.findAll({ where: { accountId: eurAccount.id }, order: [['id', 'ASC']], raw: true }),
        Transactions.findAll({ where: { accountId: usdAccount.id }, order: [['id', 'ASC']], raw: true }),
        Accounts.findByPk(uahAccount.id),
        Accounts.findByPk(eurAccount.id),
        Accounts.findByPk(usdAccount.id),
        InvestmentTransaction.findByPk(investmentTx.id),
        PortfolioTransfers.findByPk(transfer.id),
        PortfolioBalances.findOne({ where: { portfolioId: portfolio.id, currencyCode: 'USD' } }),
      ]);

      // Store what the current base currency is for verification
      const currentBaseCurrency = (await helpers.getUserCurrencies()).find((i) => i.isDefaultCurrency)!;

      // Verify original ref currency codes match current base currency (whatever it is)
      // All transactions should have been created with the same ref currency
      const originalRefCurrency = originalUahTransactions[0]?.refCurrencyCode;
      expect(originalRefCurrency).toBeDefined();
      expect(originalRefCurrency).toEqual(currentBaseCurrency.currencyCode);

      // Verify all transactions have the same original ref currency
      expect(originalUahTransactions.every((i) => i.refCurrencyCode === originalRefCurrency)).toBe(true);
      expect(originalEurTransactions.every((i) => i.refCurrencyCode === originalRefCurrency)).toBe(true);
      expect(originalUsdTransactions.every((i) => i.refCurrencyCode === originalRefCurrency)).toBe(true);

      // ========== STEP 5: Change base currency to USD ==========

      const changeStatus = await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: 'USD' });
      helpers.expectBaseCurrencyChangeCompleted(changeStatus);

      // Verify response statistics
      const result = changeStatus.result;
      expect(result.transactionsUpdated).toBeGreaterThanOrEqual(9); // 9 transactions created
      expect(result.accountsUpdated).toEqual(3); // Our 3 accounts
      expect(result.investmentTransactionsUpdated).toBeGreaterThanOrEqual(1);
      expect(result.holdingsUpdated).toBeGreaterThanOrEqual(1);
      expect(result.portfolioBalancesUpdated).toBeGreaterThanOrEqual(1);
      // Portfolio transfers might not be updated if they're self-transfers or certain conditions
      // expect(result.portfolioTransfersUpdated).toBeGreaterThanOrEqual(0);

      // ========== STEP 6: Verify base currency was changed ==========

      const newBaseCurrency = (await helpers.getUserCurrencies()).find((i) => i.isDefaultCurrency)!;
      expect(newBaseCurrency.currencyCode).toEqual('USD');
      expect(newBaseCurrency.isDefaultCurrency).toBe(true);

      // ========== STEP 7: Verify transactions were recalculated correctly ==========

      const [updatedUahTransactions, updatedEurTransactions, updatedUsdTransactions] = await Promise.all([
        Transactions.findAll({ where: { accountId: uahAccount.id }, order: [['id', 'ASC']], raw: true }),
        Transactions.findAll({ where: { accountId: eurAccount.id }, order: [['id', 'ASC']], raw: true }),
        Transactions.findAll({ where: { accountId: usdAccount.id }, order: [['id', 'ASC']], raw: true }),
      ]);

      // All transactions should now have USD as refCurrencyCode
      expect(updatedUahTransactions.every((tx) => tx.refCurrencyCode === 'USD')).toBe(true);
      expect(updatedEurTransactions.every((tx) => tx.refCurrencyCode === 'USD')).toBe(true);
      expect(updatedUsdTransactions.every((tx) => tx.refCurrencyCode === 'USD')).toBe(true);

      // Verify original amounts and currencies are preserved
      for (let i = 0; i < originalUahTransactions.length; i++) {
        expect(updatedUahTransactions[i]!.amount).toEqual(originalUahTransactions[i]!.amount);
        expect(updatedUahTransactions[i]!.currencyCode).toEqual('UAH');
        // RefAmount should have changed (unless it was 0)
        if (Number(originalUahTransactions[i]!.amount) !== 0) {
          expect(updatedUahTransactions[i]!.refAmount).not.toEqual(originalUahTransactions[i]!.refAmount);
        }
      }

      for (let i = 0; i < originalEurTransactions.length; i++) {
        expect(updatedEurTransactions[i]!.amount).toEqual(originalEurTransactions[i]!.amount);
        expect(updatedEurTransactions[i]!.currencyCode).toEqual('EUR');
        // RefAmount should have changed (unless it was 0)
        if (Number(originalEurTransactions[i]!.amount) !== 0) {
          expect(updatedEurTransactions[i]!.refAmount).not.toEqual(originalEurTransactions[i]!.refAmount);
        }
      }

      // USD transactions: refAmount should equal amount (same currency as new base)
      for (const tx of updatedUsdTransactions) {
        expect(tx.refAmount).toEqual(tx.amount);
        expect(tx.currencyCode).toEqual('USD');
        expect(tx.refCurrencyCode).toEqual('USD');
      }

      // ========== STEP 7.5: Validate refAmount calculations are CORRECT using exchange rates ==========

      // Pick 3 sample transactions from different currencies to validate calculations
      const sampleUahTx = updatedUahTransactions[0]!;
      const sampleEurTx = updatedEurTransactions[0]!;
      const sampleUsdTx = updatedUsdTransactions[0]!;

      // Fetch exchange rates for sample transaction dates using the actual service
      // This ensures we use the exact same rates the service used during base currency change
      const userId = (await helpers.getUserCurrencies())[0]!.userId;

      const uahTxDate = new Date(sampleUahTx.time);
      const eurTxDate = new Date(sampleEurTx.time);

      // Get UAH->USD and EUR->USD rates using the actual service (same as what the service uses)
      const [uahExchangeRate, eurExchangeRate] = await Promise.all([
        userExchangeRateService.getExchangeRate({ userId, date: uahTxDate, baseCode: 'UAH', quoteCode: 'USD' }),
        userExchangeRateService.getExchangeRate({ userId, date: eurTxDate, baseCode: 'EUR', quoteCode: 'USD' }),
      ]);

      // Validate UAH transaction calculation using the actual service function
      const expectedUahRefAmount = calculateRefAmountFromParams({
        baseDecimals: 2,
        quoteDecimals: 2,
        amount: Money.fromCents(Number(sampleUahTx.amount)),
        rate: uahExchangeRate.rate,
      });
      expect(Number(sampleUahTx.refAmount)).toEqualRefValue(expectedUahRefAmount.toCents());

      // Validate EUR transaction calculation using the actual service function
      const expectedEurRefAmount = calculateRefAmountFromParams({
        baseDecimals: 2,
        quoteDecimals: 2,
        amount: Money.fromCents(Number(sampleEurTx.amount)),
        rate: eurExchangeRate.rate,
      });
      expect(Number(sampleEurTx.refAmount)).toEqualRefValue(expectedEurRefAmount.toCents());

      // Validate USD transaction (should be 1:1)
      expect(sampleUsdTx.refAmount).toEqual(sampleUsdTx.amount);

      // ========== STEP 8: Verify accounts were recalculated correctly ==========

      const [updatedUahAccount, updatedEurAccount, updatedUsdAccount] = await Promise.all([
        Accounts.findByPk(uahAccount.id),
        Accounts.findByPk(eurAccount.id),
        Accounts.findByPk(usdAccount.id),
      ]);

      // Original balances and currencies should be preserved
      expect(updatedUahAccount!.initialBalance).toEqual(originalUahAccount!.initialBalance);
      expect(updatedEurAccount!.initialBalance).toEqual(originalEurAccount!.initialBalance);
      expect(updatedUsdAccount!.initialBalance).toEqual(originalUsdAccount!.initialBalance);
      expect(updatedUahAccount!.currencyCode).toEqual('UAH');
      expect(updatedEurAccount!.currencyCode).toEqual('EUR');
      expect(updatedUsdAccount!.currencyCode).toEqual('USD');

      // Ref balances should have changed for non-USD accounts
      expect(updatedUahAccount!.refInitialBalance).not.toEqual(originalUahAccount!.refInitialBalance);
      expect(updatedEurAccount!.refInitialBalance).not.toEqual(originalEurAccount!.refInitialBalance);
      expect(updatedUahAccount!.refCreditLimit).not.toEqual(originalUahAccount!.refCreditLimit);
      expect(updatedEurAccount!.refCreditLimit).not.toEqual(originalEurAccount!.refCreditLimit);

      // USD account ref values should equal original values (same currency as new base)
      expect(updatedUsdAccount!.refInitialBalance).toEqual(updatedUsdAccount!.initialBalance);
      expect(updatedUsdAccount!.refCreditLimit).toEqual(updatedUsdAccount!.creditLimit);
      // Note: refCurrentBalance might differ from currentBalance due to calculation timing
      expect(updatedUsdAccount!.refCurrentBalance).toBeDefined();

      // ========== STEPS 9-12: Fetch all post-change records in parallel ==========

      const [updatedInvestmentTx, updatedTransfer, updatedHolding, updatedPortfolioBalance] = await Promise.all([
        InvestmentTransaction.findByPk(investmentTx.id),
        PortfolioTransfers.findByPk(transfer.id),
        Holdings.findOne({ where: { portfolioId: portfolio.id, securityId: vooSecurity.id } }),
        PortfolioBalances.findOne({ where: { portfolioId: portfolio.id, currencyCode: 'USD' } }),
      ]);

      // ========== STEP 9: Verify investment transactions were recalculated correctly ==========

      // Original values preserved
      expect(updatedInvestmentTx!.amount).toEqual(originalInvestmentTx!.amount);
      expect(updatedInvestmentTx!.fees).toEqual(originalInvestmentTx!.fees);
      expect(updatedInvestmentTx!.price).toEqual(originalInvestmentTx!.price);

      // Investment tx is in USD, so ref values should equal original values
      expect(updatedInvestmentTx!.refAmount.toNumber()).toEqual(updatedInvestmentTx!.amount.toNumber());
      expect(updatedInvestmentTx!.refFees.toNumber()).toEqual(updatedInvestmentTx!.fees.toNumber());
      expect(updatedInvestmentTx!.refPrice.toNumber()).toEqual(updatedInvestmentTx!.price.toNumber());

      // ========== STEP 10: Verify portfolio transfers were recalculated correctly ==========

      if (updatedTransfer) {
        // Original amount preserved
        expect(updatedTransfer.amount).toEqual(originalTransfer!.amount);

        // Transfer is in USD, so ref amount should equal amount
        expect(updatedTransfer.refAmount.toNumber()).toEqual(updatedTransfer.amount.toNumber());
      }
      // Note: Portfolio transfers might not be updated in certain scenarios (e.g., self-transfers)

      // ========== STEP 11: Verify holdings were recalculated correctly ==========

      // Values should exist
      expect(updatedHolding!.refCostBasis).toBeDefined();

      // Holding is in USD, so ref cost basis should equal cost basis
      expect(updatedHolding!.refCostBasis.toNumber()).toEqual(updatedHolding!.costBasis.toNumber());

      // ========== STEP 12: Verify portfolio balances were recalculated correctly ==========

      // Original values preserved
      expect(updatedPortfolioBalance!.availableCash).toEqual(originalPortfolioBalance!.availableCash);
      expect(updatedPortfolioBalance!.totalCash).toEqual(originalPortfolioBalance!.totalCash);

      // Portfolio balance is in USD, so ref values should equal original values
      expect(updatedPortfolioBalance!.refAvailableCash.toNumber()).toEqual(
        updatedPortfolioBalance!.availableCash.toNumber(),
      );
      expect(updatedPortfolioBalance!.refTotalCash.toNumber()).toEqual(updatedPortfolioBalance!.totalCash.toNumber());

      // ========== STEP 13: Verify balance history was rebuilt ==========

      const [uahBalances, eurBalances] = await Promise.all([
        Balances.findAll({ where: { accountId: uahAccount.id }, order: [['date', 'ASC']] }),
        Balances.findAll({ where: { accountId: eurAccount.id }, order: [['date', 'ASC']] }),
      ]);

      // Should have balance records
      expect(uahBalances.length).toBeGreaterThan(0);
      expect(eurBalances.length).toBeGreaterThan(0);

      // ========== STEP 14: Verify new entities use new base currency ==========

      // Create a new transaction and a new account in parallel after the currency change
      const [newTx, newAccount] = await Promise.all([
        helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: eurAccount.id,
            amount: 10000, // 100 EUR
            transactionType: TRANSACTION_TYPES.expense,
            time: new Date().toISOString(),
          }),
          raw: true,
        }),
        helpers.createAccount({
          payload: {
            name: 'New EUR Account',
            currencyCode: 'EUR',
            initialBalance: 10000,
            creditLimit: 0,
            accountCategory: ACCOUNT_CATEGORIES.general,
          },
          raw: true,
        }),
      ]);

      const [newTxFromDb, newAccountFromDb] = await Promise.all([
        Transactions.findByPk(newTx[0].id),
        Accounts.findByPk(newAccount.id),
      ]);

      // New transaction should have USD as refCurrencyCode
      expect(newTxFromDb!.refCurrencyCode).toEqual('USD');

      // New account ref values should be in USD terms
      expect(newAccountFromDb!.refInitialBalance).toBeDefined();
      // Since EUR != USD, ref should differ from original
      expect(newAccountFromDb!.refInitialBalance).not.toEqual(newAccountFromDb!.initialBalance);
    });

    it('should prevent concurrent base currency change requests using the enqueue lock', async () => {
      // Add USD currency to change to
      await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });

      // Fire two enqueues concurrently: the NX lock lets exactly one through (202),
      // the other loses the race and is rejected as locked (423).
      const requests = await Promise.allSettled([
        helpers.changeBaseCurrency({ newCurrencyCode: 'USD' }),
        helpers.changeBaseCurrency({ newCurrencyCode: 'USD' }),
      ]);

      const statuses = requests.map((r) => (r.status === 'fulfilled' ? r.value.statusCode : null));

      expect(statuses).toContain(202);
      expect(statuses).toContain(ERROR_CODES.Locked);

      // Let the winning job finish (poll — don't re-enqueue) so it doesn't run
      // against the next test's truncated DB.
      await helpers.waitForBaseCurrencyChangeSettled();
    });

    it('should automatically release lock after successful operation', async () => {
      // Add USD currency to change to
      await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });

      // First change succeeds and releases the lock on completion.
      const first = await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: 'USD' });
      helpers.expectBaseCurrencyChangeCompleted(first);

      // Second change back also succeeds — the lock was released, so the enqueue
      // isn't rejected as locked.
      const second = await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: 'GBP' });
      helpers.expectBaseCurrencyChangeCompleted(second);
    });

    it('rejects a trivially-invalid change before taking the lock, leaving later changes unblocked', async () => {
      // Get current base currency
      const baseCurrency = (await helpers.getUserCurrencies()).find((i) => i.isDefaultCurrency)!;

      // Same-currency is rejected synchronously at enqueue, before the lock is taken.
      const response = await helpers.changeBaseCurrency({ newCurrencyCode: baseCurrency.currencyCode });
      expect(response.statusCode).toEqual(ERROR_CODES.ValidationError);

      // A subsequent valid change still works (no lock was ever held).
      await helpers.addUserCurrencies({ currencyCodes: ['EUR'], raw: true });
      const retry = await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: 'EUR' });
      helpers.expectBaseCurrencyChangeCompleted(retry);
    });

    // Deterministic version of the 423 window: SET the lock key directly instead of
    // racing the real change-base job, which commits too fast to observe mid-flight.
    it('blocks a guarded mutating route while the base-currency lock is held', async () => {
      const userId = (await helpers.getUserCurrencies())[0]!.userId;
      const lockKey = buildLockKey(userId);

      await redisClient.set(lockKey, 'test-lock');
      try {
        const createAccountResponse = await helpers.makeRequest({
          method: 'post',
          url: '/accounts',
          payload: {
            name: 'Blocked Account',
            currencyCode: 'USD',
            initialBalance: 10000,
            creditLimit: 0,
            accountCategory: ACCOUNT_CATEGORIES.general,
          },
        });

        expect(createAccountResponse.statusCode).toEqual(ERROR_CODES.Locked);
        expect(createAccountResponse.body.response.code).toEqual('BASE_CURRENCY_CHANGE_IN_PROGRESS');
      } finally {
        await redisClient.del(lockKey);
      }

      // Lock cleared → the same request now succeeds.
      const createAccountRetryResponse = await helpers.makeRequest({
        method: 'post',
        url: '/accounts',
        payload: {
          name: 'Successful Account',
          currencyCode: 'USD',
          initialBalance: 10000,
          creditLimit: 0,
          accountCategory: ACCOUNT_CATEGORIES.general,
        },
      });

      expect(createAccountRetryResponse.statusCode).toEqual(200);
    });
  });
});
