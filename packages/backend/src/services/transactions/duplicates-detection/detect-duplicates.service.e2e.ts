import { type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

import { type TransactionToCheck, detectDuplicates } from './detect-duplicates.service';

const createTransactionsToCheck = (overrides: Partial<TransactionToCheck>[] = []): TransactionToCheck[] => {
  const defaults: TransactionToCheck[] = [
    {
      date: '2024-01-15 10:30:00',
      amount: 100.5,
      type: 'expense',
    },
    {
      date: '2024-01-16 14:20:00',
      amount: 50,
      type: 'expense',
    },
    {
      date: '2024-01-17 09:00:00',
      amount: 2500,
      type: 'income',
    },
  ];

  return defaults.map((tx, i) => ({
    ...tx,
    ...overrides[i],
  }));
};

describe('Generic Detect Duplicates Service', () => {
  describe('basic duplicate detection', () => {
    it('should return an empty array for every no-match path', async () => {
      const account = await helpers.createAccount({ raw: true });
      const transactions = createTransactionsToCheck();

      expect(
        await detectDuplicates({
          userId: account.userId,
          accountId: account.id,
          transactions: [],
        }),
      ).toEqual([]);

      // The account holds no transactions yet, so this assertion must precede the seed below.
      expect(
        await detectDuplicates({
          userId: account.userId,
          accountId: account.id,
          transactions,
        }),
      ).toHaveLength(0);

      // Existing transaction that matches nothing in the check list
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 999.99,
          transactionType: TRANSACTION_TYPES.expense,
          time: new Date('2020-01-01').toISOString(),
        }),
        raw: true,
      });

      expect(
        await detectDuplicates({
          userId: account.userId,
          accountId: account.id,
          transactions,
        }),
      ).toHaveLength(0);

      expect(
        await detectDuplicates({
          userId: account.userId,
          accountId: generateRandomRecordId(),
          transactions,
        }),
      ).toHaveLength(0);
    });

    it('should detect duplicate when date + amount + type match', async () => {
      const account = await helpers.createAccount({ raw: true });

      const txPayload = helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100.5,
        transactionType: TRANSACTION_TYPES.expense,
        time: new Date('2024-01-15').toISOString(),
      });
      await helpers.createTransaction({ payload: txPayload, raw: true });

      const transactions = createTransactionsToCheck();

      const result = await detectDuplicates({
        userId: account.userId,
        accountId: account.id,
        transactions,
      });

      expect(result).toHaveLength(1);
      expect(result[0]!.index).toBe(0);
      expect(result[0]!.incoming.amount).toBe(100.5);
      expect(result[0]!.existing.amount).toBe(100.5);
    });

    it('should detect multiple duplicates', async () => {
      const account = await helpers.createAccount({ raw: true });

      // Create matching transactions
      const tx1 = helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100.5,
        transactionType: TRANSACTION_TYPES.expense,
        time: new Date('2024-01-15').toISOString(),
      });
      await helpers.createTransaction({ payload: tx1, raw: true });

      const tx2 = helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 50.0,
        transactionType: TRANSACTION_TYPES.expense,
        time: new Date('2024-01-16').toISOString(),
      });
      await helpers.createTransaction({ payload: tx2, raw: true });

      // 18:00 on the last date of the range: the match needs the lookup window to cover that
      // whole final day.
      const tx3 = helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 2500.0,
        transactionType: TRANSACTION_TYPES.income,
        time: new Date('2024-01-17T18:00:00').toISOString(),
      });
      await helpers.createTransaction({ payload: tx3, raw: true });

      const transactions = createTransactionsToCheck();

      const result = await detectDuplicates({
        userId: account.userId,
        accountId: account.id,
        transactions,
      });

      expect(result).toHaveLength(3);
      expect(result.map((d) => d.index).toSorted()).toEqual([0, 1, 2]);
    });
  });

  describe('matching criteria', () => {
    it('should NOT match on a near miss of type, amount or date', async () => {
      const [typeAccount, amountAccount, dateAccount] = await Promise.all([
        helpers.createAccount({ raw: true }),
        helpers.createAccount({ raw: true }),
        helpers.createAccount({ raw: true }),
      ]);

      // INCOME with the same date and amount as the EXPENSE in the check list
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: typeAccount.id,
          amount: 100.5,
          transactionType: TRANSACTION_TYPES.income,
          time: new Date('2024-01-15').toISOString(),
        }),
        raw: true,
      });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: amountAccount.id,
          amount: 100.51, // 1 cent difference
          transactionType: TRANSACTION_TYPES.expense,
          time: new Date('2024-01-15').toISOString(),
        }),
        raw: true,
      });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: dateAccount.id,
          amount: 100.5,
          transactionType: TRANSACTION_TYPES.expense,
          time: new Date('2024-01-14').toISOString(), // 1 day before
        }),
        raw: true,
      });

      const transactions = createTransactionsToCheck();

      expect(
        await detectDuplicates({
          userId: typeAccount.userId,
          accountId: typeAccount.id,
          transactions,
        }),
      ).toHaveLength(0);
      expect(
        await detectDuplicates({
          userId: amountAccount.userId,
          accountId: amountAccount.id,
          transactions,
        }),
      ).toHaveLength(0);
      expect(
        await detectDuplicates({
          userId: dateAccount.userId,
          accountId: dateAccount.id,
          transactions,
        }),
      ).toHaveLength(0);
    });

    it('should match on the day regardless of time and of the incoming date format', async () => {
      const account = await helpers.createAccount({ raw: true });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100.5,
          transactionType: TRANSACTION_TYPES.expense,
          time: new Date('2024-01-15T23:59:59').toISOString(),
        }),
        raw: true,
      });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100.5,
          transactionType: TRANSACTION_TYPES.expense,
          time: new Date('2024-01-20T14:00:00').toISOString(),
        }),
        raw: true,
      });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 50.0,
          transactionType: TRANSACTION_TYPES.expense,
          time: new Date('2024-01-31T23:59:59').toISOString(),
        }),
        raw: true,
      });

      const transactions: TransactionToCheck[] = [
        {
          date: '2024-01-15 10:30:00',
          amount: 100.5,
          type: 'expense',
        },
        { date: '2024-01-20', amount: 100.5, type: 'expense' },
        { date: '2024-01-31 12:00:00', amount: 50, type: 'expense' },
      ];

      const result = await detectDuplicates({
        userId: account.userId,
        accountId: account.id,
        transactions,
      });

      expect(result).toHaveLength(3);
      expect(result.map((d) => d.index).toSorted()).toEqual([0, 1, 2]);
    });
  });

  describe('date range handling', () => {
    it('should handle transactions spanning multiple months', async () => {
      const account = await helpers.createAccount({ raw: true });

      const txPayload = helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 20.0,
        transactionType: TRANSACTION_TYPES.expense,
        time: new Date('2024-02-15').toISOString(),
      });
      await helpers.createTransaction({ payload: txPayload, raw: true });

      const transactions: TransactionToCheck[] = [
        { date: '2024-01-31', amount: 10, type: 'expense' },
        { date: '2024-02-15', amount: 20, type: 'expense' },
        { date: '2024-03-01', amount: 30, type: 'expense' },
      ];

      const result = await detectDuplicates({
        userId: account.userId,
        accountId: account.id,
        transactions,
      });

      expect(result).toHaveLength(1);
      expect(result[0]!.index).toBe(1);
    });
  });

  describe('response structure', () => {
    it('should return correct DuplicateMatch structure', async () => {
      const account = await helpers.createAccount({ raw: true });

      const txPayload = helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100.5,
        transactionType: TRANSACTION_TYPES.expense,
        time: new Date('2024-01-15').toISOString(),
        note: 'Test note for matching',
      });
      await helpers.createTransaction({ payload: txPayload, raw: true });

      const transactions = createTransactionsToCheck();

      const result = await detectDuplicates({
        userId: account.userId,
        accountId: account.id,
        transactions,
      });

      expect(result).toHaveLength(1);

      const match = result[0]!;

      // Check index
      expect(typeof match.index).toBe('number');
      expect(match.index).toBe(0);

      // Check incoming (preserves original transaction)
      expect(match.incoming).toEqual({
        date: '2024-01-15 10:30:00',
        amount: 100.5,
        type: 'expense',
      });

      // Check existing
      expect(typeof match.existing.id).toBe('string');
      expect(match.existing.date).toBe('2024-01-15');
      expect(match.existing.amount).toBe(100.5);
      expect(match.existing.note).toBe('Test note for matching');

      const emptyNoteAccount = await helpers.createAccount({ raw: true });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: emptyNoteAccount.id,
          amount: 100.5,
          transactionType: TRANSACTION_TYPES.expense,
          time: new Date('2024-01-15').toISOString(),
          note: '',
        }),
        raw: true,
      });

      const emptyNoteResult = await detectDuplicates({
        userId: emptyNoteAccount.userId,
        accountId: emptyNoteAccount.id,
        transactions,
      });

      expect(emptyNoteResult).toHaveLength(1);
      expect(emptyNoteResult[0]!.existing.note).toBe('');
    });

    it('should preserve generic type T in incoming field', async () => {
      const account = await helpers.createAccount({ raw: true });

      const txPayload = helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100.5,
        transactionType: TRANSACTION_TYPES.expense,
        time: new Date('2024-01-15').toISOString(),
      });
      await helpers.createTransaction({ payload: txPayload, raw: true });

      // Extended type with extra fields
      interface ExtendedTransaction extends TransactionToCheck {
        customField: string;
        metadata: { source: string };
      }

      const transactions: ExtendedTransaction[] = [
        {
          date: '2024-01-15',
          amount: 100.5,
          type: 'expense',
          customField: 'test-value',
          metadata: { source: 'bank-sync' },
        },
      ];

      const result = await detectDuplicates({
        userId: account.userId,
        accountId: account.id,
        transactions,
      });

      expect(result).toHaveLength(1);
      // Extra fields should be preserved
      expect(result[0]!.incoming.customField).toBe('test-value');
      expect(result[0]!.incoming.metadata).toEqual({ source: 'bank-sync' });
    });
  });

  describe('account isolation', () => {
    it('should find correct duplicate when both accounts have similar transactions', async () => {
      const account1 = await helpers.createAccount({ raw: true });
      const account2 = await helpers.createAccount({ raw: true });

      // Create same transaction in both accounts
      const tx1 = helpers.buildTransactionPayload({
        accountId: account1.id,
        amount: 100.5,
        transactionType: TRANSACTION_TYPES.expense,
        time: new Date('2024-01-15').toISOString(),
        note: 'Account 1 transaction',
      });
      await helpers.createTransaction({ payload: tx1, raw: true });

      const tx2 = helpers.buildTransactionPayload({
        accountId: account2.id,
        amount: 100.5,
        transactionType: TRANSACTION_TYPES.expense,
        time: new Date('2024-01-15').toISOString(),
        note: 'Account 2 transaction',
      });
      await helpers.createTransaction({ payload: tx2, raw: true });

      const transactions = createTransactionsToCheck();

      // Check against account1
      const result1 = await detectDuplicates({
        userId: account1.userId,
        accountId: account1.id,
        transactions,
      });

      expect(result1).toHaveLength(1);
      expect(result1[0]!.existing.note).toBe('Account 1 transaction');

      // Check against account2
      const result2 = await detectDuplicates({
        userId: account2.userId,
        accountId: account2.id,
        transactions,
      });

      expect(result2).toHaveLength(1);
      expect(result2[0]!.existing.note).toBe('Account 2 transaction');
    });
  });

  describe('currency decimals', () => {
    const createKwdAccount = async () => {
      await helpers.addUserCurrencies({ currencyCodes: ['KWD'], raw: true });
      return helpers.createAccount({ payload: helpers.buildAccountPayload({ currencyCode: 'KWD' }), raw: true });
    };

    const createExpense = ({ accountId, amount }: { accountId: RecordId; amount: number }) =>
      helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId,
          amount,
          transactionType: TRANSACTION_TYPES.expense,
          time: new Date('2024-01-15').toISOString(),
        }),
        raw: true,
      });

    it('does not flag a KWD 1.234 against an existing 1.231, and flags it against an existing 1.234', async () => {
      const account = await createKwdAccount();
      const transactions: TransactionToCheck[] = [{ date: '2024-01-15', amount: 1.234, type: 'expense' }];

      await createExpense({ accountId: account.id, amount: 1.231 });

      expect(await detectDuplicates({ userId: account.userId, accountId: account.id, transactions })).toHaveLength(0);

      await createExpense({ accountId: account.id, amount: 1.234 });

      const result = await detectDuplicates({ userId: account.userId, accountId: account.id, transactions });

      expect(result).toHaveLength(1);
      expect(result[0]!.existing.amount).toBe(1.234);
    });

    it('rounds an incoming amount to the account currency before it is keyed', async () => {
      const kwdAccount = await createKwdAccount();
      const baseAccount = await helpers.createAccount({ raw: true });

      await createExpense({ accountId: kwdAccount.id, amount: 1.235 });
      await createExpense({ accountId: baseAccount.id, amount: 12.35 });

      expect(
        await detectDuplicates({
          userId: kwdAccount.userId,
          accountId: kwdAccount.id,
          transactions: [{ date: '2024-01-15', amount: 1.2345, type: 'expense' }],
        }),
      ).toHaveLength(1);
      expect(
        await detectDuplicates({
          userId: baseAccount.userId,
          accountId: baseAccount.id,
          transactions: [{ date: '2024-01-15', amount: 12.345, type: 'expense' }],
        }),
      ).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    it('should handle large number of transactions efficiently', async () => {
      const account = await helpers.createAccount({ raw: true });

      // Create 10 existing transactions
      for (let i = 0; i < 10; i++) {
        const txPayload = helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 10 * (i + 1),
          transactionType: TRANSACTION_TYPES.expense,
          time: new Date(`2024-01-${String(i + 1).padStart(2, '0')}`).toISOString(),
        });
        await helpers.createTransaction({ payload: txPayload, raw: true });
      }

      // Check 20 transactions (10 should match)
      const transactions: TransactionToCheck[] = [];
      for (let i = 0; i < 20; i++) {
        transactions.push({
          date: `2024-01-${String(i + 1).padStart(2, '0')}`,
          amount: 10 * (i + 1),
          type: 'expense',
        });
      }

      const result = await detectDuplicates({
        userId: account.userId,
        accountId: account.id,
        transactions,
      });

      expect(result).toHaveLength(10);
    });

    it('should handle multiple transactions with same date/amount/type', async () => {
      const account = await helpers.createAccount({ raw: true });

      // Create two identical transactions in DB
      for (let i = 0; i < 2; i++) {
        const txPayload = helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 50.0,
          transactionType: TRANSACTION_TYPES.expense,
          time: new Date('2024-01-15').toISOString(),
          note: `Transaction ${i + 1}`,
        });
        await helpers.createTransaction({ payload: txPayload, raw: true });
      }

      const transactions: TransactionToCheck[] = [{ date: '2024-01-15', amount: 50, type: 'expense' }];

      const result = await detectDuplicates({
        userId: account.userId,
        accountId: account.id,
        transactions,
      });

      // Should return one match (uses first matching transaction)
      expect(result).toHaveLength(1);
    });
  });
});
