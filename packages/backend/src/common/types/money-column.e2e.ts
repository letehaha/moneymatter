/**
 * E2E tests for @MoneyField getter/setter integration with Sequelize.
 *
 * Verifies that Money conversion works correctly across different
 * Sequelize query patterns: normal queries, raw: true, aggregates,
 * literal updates, and direct model operations.
 */
import { TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import Accounts from '@models/accounts.model';
import Balances from '@models/balances.model';
import Transactions from '@models/transactions.model';
import * as helpers from '@tests/helpers';

import { Money } from './money';

describe('MoneyField integration', () => {
  describe('Transactions model (INTEGER cents storage)', () => {
    it('exposes Money via getters, plain cents via raw: true, and decimals through toJSON and the API', async () => {
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
      // raw: true bypasses getters, returns plain DB values (cents)
      expect(Money.isMoney(rawTx!.amount)).toBe(false);
      expect(typeof rawTx!.amount).toBe('number');
      expect(rawTx!.amount as unknown as number).toBe(2550); // 25.50 * 100 = 2550 cents
      expect(rawTx!.commissionRate as unknown as number).toBe(0);

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
      expect(raw!.amount as unknown as number).toBe(4299); // stored as cents
      expect(raw!.refAmount as unknown as number).toBe(4299);
      expect(raw!.commissionRate as unknown as number).toBe(0);

      // Normal read returns Money
      const normal = await Transactions.findByPk(tx.id);
      expect(normal!.amount.toNumber()).toBe(42.99);
    });

    it('instance.save() persists Money via the setter for amount and refAmount', async () => {
      // Mirrors change-base-currency: set Money on the instance, then save.
      // Model.update() would instead trigger the getter during SQL generation and hand
      // Sequelize a Money object it cannot serialize into an INTEGER column.
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
      expect(raw!.amount as unknown as number).toBe(2050);
      expect(raw!.refAmount as unknown as number).toBe(5517); // 55.17 * 100 = 5517 cents
    });
  });

  describe('Balances model (INTEGER cents storage)', () => {
    it('returns Money via getters, applies and accumulates literal updates, and sums raw cents', async () => {
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
      await expect(applyLiteral('amount + 5000')).resolves.not.toThrow();
      // 10000 cents + 5000 cents = 15000 cents = 150 decimal
      expect((await readBalance())!.amount.toNumber()).toBe(150);

      await applyLiteral('amount - 5000');
      // 15000 cents - 5000 cents = 10000 cents = 100 decimal
      expect((await readBalance())!.amount.toNumber()).toBe(100);

      // This is the exact pattern used in Balances.updateBalanceIncremental()
      const incrementAmount = Money.fromDecimal(25.5);
      await applyLiteral(`amount + ${incrementAmount.toCents()}`);
      expect((await readBalance())!.amount.toNumber()).toBe(125.5);

      // Pattern: amount.negate().toCents() for reversing a transaction
      const amount = Money.fromDecimal(50);
      await applyLiteral(`amount + ${amount.negate().toCents()}`);
      expect((await readBalance())!.amount.toNumber()).toBe(75.5);

      // Simulate multiple transactions affecting the same balance record
      await applyLiteral('amount + 1000');
      await applyLiteral('amount + 2000');
      await applyLiteral('amount - 500');
      // 7550 + 1000 + 2000 - 500 = 10050 cents = 100.5 decimal
      expect((await readBalance())!.amount.toNumber()).toBe(100.5);

      const result = await Balances.sum('amount', {
        where: { accountId: account.id },
      });

      // Sequelize aggregates return raw DB values
      expect(typeof result).toBe('number');
      expect(result).toBe(10050);
    });
  });

  describe('Accounts model (INTEGER cents storage)', () => {
    it('findOne returns Money for all money fields, raw: true returns plain cents', async () => {
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

      expect(typeof (rawAccount!.initialBalance as unknown)).toBe('number');
      expect(rawAccount!.initialBalance as unknown as number).toBe(25075); // 250.75 * 100
      expect(rawAccount!.creditLimit as unknown as number).toBe(100000); // 1000 * 100
    });
  });

  describe('Bug regressions', () => {
    it('tracker stats: rule tracker stats returns correct decimal amounts', async () => {
      // Decimals treated as cents by the stats serializer would turn 1.5 into 0.015.
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 500 }),
        raw: true,
      });

      const testCategory = await helpers.addCustomCategory({ name: 'test-cat', color: '#000000', raw: true });
      const tracker = await helpers.createTracker({
        name: 'test-tracker',
        categoryIds: [testCategory.id],
        limitAmount: 1000,
        rulesEnabled: true,
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
      await helpers.editTracker({ id: tracker.id, params: { rulesEnabled: true } });

      const stats = await helpers.getTrackerStats({ id: tracker.id, raw: true });

      // Must be 1.5 (decimal), NOT 0.015 (double-converted)
      expect(stats!.summary.actualExpense).toBeCloseTo(1.5, 2);
    });

    it('tag reminders: amountThreshold stored in JSONB must survive roundtrip', async () => {
      // Bug: deserializer converted amountThreshold to Money, service stored Money
      // in JSONB (serialized via toJSON() → decimal). Serializer read it back as cents
      // via Money.fromCents(decimal), causing 100x error.
      //
      // Fix: deserializer should convert to cents (plain number) for JSONB storage.
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
