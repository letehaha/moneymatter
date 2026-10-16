/**
 * E2E tests for @MoneyField getter/setter integration with Sequelize.
 *
 * Verifies that Money conversion works correctly across different
 * Sequelize query patterns: normal queries, raw: true, aggregates,
 * literal updates, and direct model operations.
 */
import { TRACKER_TYPES, TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import Accounts from '@models/accounts.model';
import Balances from '@models/balances.model';
import Transactions from '@models/transactions.model';
import * as helpers from '@tests/helpers';

import { Money } from './money';
import { toMoneyColumnValue } from './money-column';

describe('MoneyField integration', () => {
  describe('Transactions model (DECIMAL storage)', () => {
    it('exposes Money via getters, exact decimal strings via raw: true, and decimals through toJSON and the API', async () => {
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 500 }),
        raw: true,
      });

      const [createdTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 25.5,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      // POST /transactions response carries decimals
      expect(createdTx.amount).toBe(25.5);
      expect(createdTx.commissionRate).toBe(0);
      expect(createdTx.cashbackAmount).toBe(0);

      const tx = await Transactions.findOne({
        where: { accountId: account.id },
      });

      expect(tx).not.toBeNull();
      // Getter should return Money objects
      expect(Money.isMoney(tx!.amount)).toBe(true);
      expect(Money.isMoney(tx!.refAmount)).toBe(true);
      expect(Money.isMoney(tx!.commissionRate)).toBe(true);
      expect(Money.isMoney(tx!.refCommissionRate)).toBe(true);
      expect(Money.isMoney(tx!.cashbackAmount)).toBe(true);

      // Values should be correct decimals (not cents)
      expect(tx!.amount.toNumber()).toBe(25.5);
      expect(tx!.commissionRate.toNumber()).toBe(0);

      // Simulate what res.json() does
      const json = JSON.parse(JSON.stringify(tx!.toJSON()));

      expect(typeof json.amount).toBe('number');
      expect(json.amount).toBe(25.5);
      expect(typeof json.commissionRate).toBe('number');
      expect(json.commissionRate).toBe(0);

      const rawTx = await Transactions.findOne({
        where: { accountId: account.id },
        raw: true,
      });

      expect(rawTx).not.toBeNull();
      // raw: true bypasses getters, returns the DECIMAL column as an exact string
      expect(Money.isMoney(rawTx!.amount)).toBe(false);
      expect(typeof rawTx!.amount).toBe('string');
      expect(Money.fromDecimal(rawTx!.amount as unknown as string).toNumber()).toBe(25.5);
      expect(Money.fromDecimal(rawTx!.commissionRate as unknown as string).toNumber()).toBe(0);

      const response = await helpers.getTransactions({ raw: true });

      expect(response.length).toBeGreaterThan(0);
      const listed = response.find((t) => t.accountId === account.id);
      expect(listed).toBeDefined();
      expect(listed!.amount).toBe(25.5);
    });

    it('create accepts Money objects via setters', async () => {
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 500 }),
        raw: true,
      });

      // Create directly via model with Money objects
      const tx = await Transactions.create({
        amount: Money.fromDecimal(42.99),
        refAmount: Money.fromDecimal(42.99),
        commissionRate: Money.zero(),
        refCommissionRate: Money.zero(),
        cashbackAmount: Money.zero(),
        accountId: account.id,
        userId: global.APP_USER_ID,
        transactionType: TRANSACTION_TYPES.expense,
        paymentType: 'creditCard',
        transferNature: 'not_transfer',
        time: new Date(),
        categoryId: global.DEFAULT_CATEGORY_ID,
        currencyCode: global.BASE_CURRENCY.code,
        accountType: 'system',
        refCurrencyCode: null,
      });

      // Re-read to verify stored correctly
      const raw = await Transactions.findByPk(tx.id, { raw: true });
      expect(Money.fromDecimal(raw!.amount as unknown as string).toNumber()).toBe(42.99);
      expect(Money.fromDecimal(raw!.refAmount as unknown as string).toNumber()).toBe(42.99);
      expect(Money.fromDecimal(raw!.commissionRate as unknown as string).toNumber()).toBe(0);

      // Normal read returns Money
      const normal = await Transactions.findByPk(tx.id);
      expect(normal!.amount.toNumber()).toBe(42.99);
    });

    it('instance.save() persists Money via the setter for amount and refAmount', async () => {
      // Mirrors change-base-currency: set Money on the instance, then save.
      // Model.update() would instead trigger the getter during SQL generation and hand
      // Sequelize a Money object it cannot serialize into a DECIMAL column.
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 500 }),
        raw: true,
      });

      const [baseTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 10,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      const tx = await Transactions.findByPk(baseTx.id);
      if (!tx) throw new Error('Transaction not found');

      tx.amount = Money.fromDecimal(20.5);
      await tx.save();
      // hooks: false covers the change-base-currency path, which writes refAmount without triggering update hooks
      tx.refAmount = Money.fromDecimal(55.17);
      await tx.save({ hooks: false });

      // Verify via raw query
      const raw = await Transactions.findByPk(baseTx.id, { raw: true });
      expect(Money.fromDecimal(raw!.amount as unknown as string).toNumber()).toBe(20.5);
      expect(Money.fromDecimal(raw!.refAmount as unknown as string).toNumber()).toBe(55.17);
    });
  });

  describe('Balances model (DECIMAL storage)', () => {
    it('returns Money via getters, applies and accumulates literal updates, and sums decimals', async () => {
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 100 }),
        raw: true,
      });

      const readBalance = () => Balances.findOne({ where: { accountId: account.id } });
      const applyLiteral = (expression: string) =>
        Balances.update({ amount: Balances.sequelize!.literal(expression) }, { where: { accountId: account.id } });

      const initial = await readBalance();
      expect(initial).not.toBeNull();
      expect(Money.isMoney(initial!.amount)).toBe(true);
      // initialBalance = 100 decimal → refInitialBalance in base currency
      expect(initial!.amount.toNumber()).toBe(100);

      // Sequelize internally builds a temp instance and triggers setter then getter on the Literal.
      await expect(applyLiteral('amount + 50')).resolves.not.toThrow();
      expect((await readBalance())!.amount.toNumber()).toBe(150);

      await applyLiteral('amount - 50');
      expect((await readBalance())!.amount.toNumber()).toBe(100);

      // This is the exact pattern used in Balances.updateBalanceIncremental()
      const incrementAmount = Money.fromDecimal(25.5);
      await applyLiteral(`amount + (${toMoneyColumnValue({ money: incrementAmount })})`);
      expect((await readBalance())!.amount.toNumber()).toBe(125.5);

      // Pattern: a negated amount reverses a transaction
      const amount = Money.fromDecimal(50);
      await applyLiteral(`amount + (${toMoneyColumnValue({ money: amount.negate() })})`);
      expect((await readBalance())!.amount.toNumber()).toBe(75.5);

      // Simulate multiple transactions affecting the same balance record
      await applyLiteral('amount + 10');
      await applyLiteral('amount + 20');
      await applyLiteral('amount - 5');
      expect((await readBalance())!.amount.toNumber()).toBe(100.5);

      const result = await Balances.sum('amount', {
        where: { accountId: account.id },
      });

      // Sequelize aggregates over a DECIMAL column come back as plain numbers
      expect(typeof result).toBe('number');
      expect(result).toBe(100.5);
    });
  });

  describe('Accounts model (DECIMAL storage)', () => {
    it('findOne returns Money for all money fields, raw: true returns exact decimal strings', async () => {
      const created = await helpers.createAccount({
        payload: helpers.buildAccountPayload({
          initialBalance: 250.75,
          creditLimit: 1000,
        }),
        raw: true,
      });

      const account = await Accounts.findByPk(created.id);

      expect(account).not.toBeNull();
      expect(Money.isMoney(account!.initialBalance)).toBe(true);
      expect(Money.isMoney(account!.currentBalance)).toBe(true);
      expect(Money.isMoney(account!.creditLimit)).toBe(true);
      expect(Money.isMoney(account!.refInitialBalance)).toBe(true);
      expect(Money.isMoney(account!.refCurrentBalance)).toBe(true);
      expect(Money.isMoney(account!.refCreditLimit)).toBe(true);

      expect(account!.initialBalance.toNumber()).toBe(250.75);
      expect(account!.creditLimit.toNumber()).toBe(1000);

      const rawAccount = await Accounts.findByPk(created.id, { raw: true });

      expect(typeof (rawAccount!.initialBalance as unknown)).toBe('string');
      expect(Money.fromDecimal(rawAccount!.initialBalance as unknown as string).toNumber()).toBe(250.75);
      expect(Money.fromDecimal(rawAccount!.creditLimit as unknown as string).toNumber()).toBe(1000);
    });
  });

  describe('Bug regressions', () => {
    it('tracker stats: category tracker stats returns correct decimal amounts', async () => {
      // Bug: getCategoryTrackerStats() accumulated tx.refAmount.toNumber() (decimals)
      // but serializeTrackerStats.toApiDecimal() treated plain numbers as cents.
      // Result: 150 cents → .toNumber() = 1.5 → fromCents(1.5) = 0.015 (100x too small)
      //
      // Fix: getCategoryTrackerStats() should use .toCents() to keep raw cents,
      // consistent with getManualTrackerStats() which uses raw: true.
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 500 }),
        raw: true,
      });

      const testCategory = await helpers.addCustomCategory({ name: 'test-cat', color: '#000000', raw: true });
      const tracker = await helpers.createTracker({
        name: 'test-tracker',
        categoryIds: [testCategory.id],
        limitAmount: 1000,
        type: TRACKER_TYPES.category,
        raw: true,
      });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1.5,
          categoryId: testCategory.id,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      const stats = await helpers.getTrackerStats({ id: tracker.id, raw: true });

      // Must be 1.5 (decimal), NOT 0.015 (double-converted)
      expect(stats!.summary.actualExpense).toBeCloseTo(1.5, 2);
    });

    it('tag reminders: amountThreshold stored in JSONB must survive roundtrip', async () => {
      // The threshold lives in JSONB as the plain decimal the API sends. An earlier version
      // stored cents and the serializer divided by 100; a mismatch between the two sides
      // shows up here as a 100x error.
      const tag = await helpers.createTag({
        payload: helpers.buildTagPayload(),
        raw: true,
      });

      const reminder = await helpers.createTagReminder({
        tagId: tag.id,
        payload: {
          type: 'amount_threshold',
          settings: { amountThreshold: 1500 },
        },
        raw: true,
      });

      // API should return the same decimal value that was sent
      expect(reminder.settings.amountThreshold).toBe(1500);
    });

    it('GET /accounts returns array of serialized accounts', async () => {
      // Verify accounts endpoint returns proper array (not undefined or error)
      await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 100 }),
        raw: true,
      });

      const res = await helpers.makeRequest({ method: 'get', url: '/accounts' });
      expect(res.statusCode).toBe(200);

      const accounts = helpers.extractResponse(res);
      expect(Array.isArray(accounts)).toBe(true);
      expect(accounts.length).toBeGreaterThan(0);
    });
  });
});
