import {
  AccountOptionValue,
  BLANK_FILTER_VALUE,
  CATEGORIZATION_SOURCE,
  CategoryOptionValue,
  CurrencyOptionValue,
  FILTER_OPERATION,
  type RecordId,
  SORT_DIRECTIONS,
  TRANSACTION_SORT_FIELD,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  TransactionTypeOptionValue,
  asDecimal,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { expectCsvImportCompleted, waitForCsvImportCompletion } from '@tests/helpers/import-export';
import { VALID_GEMINI_API_KEY, createGeminiMock } from '@tests/mocks/gemini/mock-api';
import { compareAsc, compareDesc, startOfDay, subDays } from 'date-fns';

const sortedIds = (txs: { id: string }[]) => txs.map((tx) => tx.id).toSorted();

const dates = {
  income: '2024-08-02T00:00:00Z',
  expense: '2024-08-03T00:00:00Z',
  transfer: '2024-09-03T00:00:00Z',
  refunds: '2024-07-03T00:00:00Z',
};

// One plain expense + one out-of-wallet transfer + one common transfer pair,
// used by the transferNatures filter cases.
const setupMixedNatures = async () => {
  const accountA = await helpers.createAccount({ raw: true });
  const accountB = await helpers.createAccount({ raw: true });

  const [plain] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({ accountId: accountA.id, amount: 100 }),
    raw: true,
  });
  const [outOfWallet] = await helpers.createTransaction({
    payload: {
      ...helpers.buildTransactionPayload({ accountId: accountA.id, amount: 200 }),
      transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
    },
    raw: true,
  });
  const [transferBase, transferOpposite] = await helpers.createTransaction({
    payload: {
      ...helpers.buildTransactionPayload({ accountId: accountA.id, amount: 300 }),
      transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      destinationAmount: 300,
      destinationAccountId: accountB.id,
    },
    raw: true,
  });

  return { plain, outOfWallet, transferBase, transferOpposite };
};

describe('Retrieve transactions with filters', () => {
  const createMockTransactions = async () => {
    const accountA = await helpers.createAccount({ raw: true });
    const {
      currencies: [currencyB],
    } = await helpers.addUserCurrencies({ currencyCodes: ['UAH'], raw: true });
    const accountB = await helpers.createAccount({
      payload: {
        ...helpers.buildAccountPayload(),
        currencyCode: currencyB!.currencyCode,
      },
      raw: true,
    });

    const [income] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountA.id,
        amount: 2000,
        transactionType: TRANSACTION_TYPES.income,
        time: dates.income,
      }),
      raw: true,
    });
    const [expense] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountB.id,
        amount: 2000,
        transactionType: TRANSACTION_TYPES.expense,
        time: dates.expense,
      }),
      raw: true,
    });
    const [transferIncome, transferExpense] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: accountA.id,
          amount: 5000,
        }),
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationAmount: 10000,
        destinationAccountId: accountB.id,
        time: dates.transfer,
      },
      raw: true,
    });

    const [refundOriginal] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountA.id,
        amount: 1000,
        transactionType: TRANSACTION_TYPES.income,
        time: dates.refunds,
      }),
      raw: true,
    });
    const refundTxPayload = {
      ...helpers.buildTransactionPayload({
        accountId: accountA.id,
        amount: 1000,
        transactionType: TRANSACTION_TYPES.expense,
        time: dates.refunds,
      }),
      refundForTxId: refundOriginal.id,
    };
    const [refundTx] = await helpers.createTransaction({
      payload: refundTxPayload,
      raw: true,
    });

    return {
      income,
      expense,
      transferIncome,
      transferExpense,
      refundOriginal,
      refundTx,
    };
  };

  it('should retrieve transactions filtered by budgetIds correctly', async () => {
    const account = await helpers.createAccount({ raw: true });
    const categories = await helpers.getCategoriesList();
    const firstCategoryId = categories[0]!.id;

    const transactions = await Promise.all([
      helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-03-02T10:00:00Z',
          categoryId: firstCategoryId,
        }),
        raw: true,
      }),
      helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 200,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-03-03T10:00:00Z',
          categoryId: firstCategoryId,
        }),
        raw: true,
      }),
      helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 300,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-04-01T10:00:00Z',
          categoryId: firstCategoryId,
        }),
        raw: true,
      }),
    ]);

    const budget = await helpers.createCustomBudget({
      name: 'Test Budget',
      startDate: '2025-03-01T00:00:00Z',
      endDate: '2025-03-04T23:59:59Z',
      autoInclude: true,
      limitAmount: 500,
      raw: true,
    });

    const res = await helpers.getTransactions({
      budgetIds: [budget.id],
      limit: 30,
      raw: true,
    });

    expect(res.length).toBe(2);
    const transactionIds = res.map((t) => t.id);
    expect(transactionIds).toContain(transactions[0][0].id);
    expect(transactionIds).toContain(transactions[1][0].id);
    expect(transactionIds).not.toContain(transactions[2][0].id);
  });

  it('filters by date bounds', async () => {
    await createMockTransactions();

    const fromIncome = await helpers.getTransactions({ from: dates.income, raw: true });
    expect(fromIncome.length).toBe(4); // income, expense, two transfers

    const toIncome = await helpers.getTransactions({ to: dates.income, raw: true });
    expect(toIncome.length).toBe(3); // income, two refunds

    const range = await helpers.getTransactions({ from: dates.income, to: dates.expense, raw: true });
    expect(range.length).toBe(2); // income, expense

    const singleDay = await helpers.getTransactions({ from: dates.income, to: dates.income, raw: true });
    expect(singleDay.length).toBe(1); // income

    // The fixture holds six rows and no categorization run stamped any of them, so an
    // ignored `categorizedAt` filter returns all six instead of an empty list.
    const unknownStamp = await helpers.getTransactions({ categorizedAt: new Date().toISOString(), raw: true });
    expect(unknownStamp).toEqual([]);
  }, 60_000);

  describe('pagination (offset)', () => {
    // Default sort is `time` descending, so pages walk newest → oldest.
    const times = [
      '2024-06-01T00:00:00Z',
      '2024-06-02T00:00:00Z',
      '2024-06-03T00:00:00Z',
      '2024-06-04T00:00:00Z',
      '2024-06-05T00:00:00Z',
    ];

    const seedPaginationTransactions = async () => {
      const account = await helpers.createAccount({ raw: true });
      for (const time of times) {
        await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 100, time }),
          raw: true,
        });
      }
      return account;
    };

    it('[success] walks non-overlapping pages via `offset`', async () => {
      const account = await seedPaginationTransactions();

      const page1 = await helpers.getTransactions({ accountIds: [account.id], limit: 2, offset: 0, raw: true });
      const page2 = await helpers.getTransactions({ accountIds: [account.id], limit: 2, offset: 2, raw: true });
      const page3 = await helpers.getTransactions({ accountIds: [account.id], limit: 2, offset: 4, raw: true });

      expect(page1.length).toBe(2);
      expect(page2.length).toBe(2);
      expect(page3.length).toBe(1);

      const isoTimes = (page: typeof page1) => page.map((t) => new Date(t.time).toISOString());

      // Newest-first ordering carries across pages.
      expect(isoTimes(page1)).toEqual(['2024-06-05T00:00:00.000Z', '2024-06-04T00:00:00.000Z']);
      expect(isoTimes(page2)).toEqual(['2024-06-03T00:00:00.000Z', '2024-06-02T00:00:00.000Z']);
      expect(isoTimes(page3)).toEqual(['2024-06-01T00:00:00.000Z']);

      // No row appears on two pages.
      const ids = [...page1, ...page2, ...page3].map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);

      const withoutOffset = await helpers.getTransactions({ accountIds: [account.id], limit: 2, raw: true });
      expect(isoTimes(withoutOffset)).toEqual(['2024-06-05T00:00:00.000Z', '2024-06-04T00:00:00.000Z']);
    });
  });

  it('filters the fixture by transfer/refund flags', async () => {
    const { income, expense, refundOriginal, refundTx } = await createMockTransactions();

    const byType = await helpers.getTransactions({ transactionType: TRANSACTION_TYPES.expense, raw: true });
    expect(byType.length).toBe(3); // expense, 1 of transfers, 1 of refunds
    expect(byType.every((t) => t.transactionType === TRANSACTION_TYPES.expense)).toBe(true);

    const excludeTransfer = await helpers.getTransactions({ excludeTransfer: true, raw: true });
    expect(excludeTransfer.length).toBe(4); // income, expense, refunds
    expect(excludeTransfer.every((t) => t.transferNature === TRANSACTION_TRANSFER_NATURE.not_transfer)).toBe(true);

    const excludeRefunds = await helpers.getTransactions({ excludeRefunds: true, raw: true });
    expect(excludeRefunds.length).toBe(4);
    expect(excludeRefunds.every((t) => t.refundLinked === false)).toBe(true);

    const transfersOnly = await helpers.getTransactions({ transferFilter: FILTER_OPERATION.only, raw: true });
    expect(transfersOnly.length).toBe(2); // transferIncome, transferExpense
    expect(transfersOnly.every((t) => t.transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer)).toBe(true);

    const refundsOnly = await helpers.getTransactions({ refundFilter: FILTER_OPERATION.only, raw: true });
    expect(refundsOnly.length).toBe(2); // refundOriginal, refundTx
    expect(refundsOnly.every((t) => t.refundLinked === true)).toBe(true);

    const transfersExcluded = await helpers.getTransactions({ transferFilter: FILTER_OPERATION.exclude, raw: true });
    expect(transfersExcluded.length).toBe(4); // income, expense, refunds
    expect(transfersExcluded.every((t) => t.transferNature === TRANSACTION_TRANSFER_NATURE.not_transfer)).toBe(true);

    const refundsExcluded = await helpers.getTransactions({ refundFilter: FILTER_OPERATION.exclude, raw: true });
    expect(refundsExcluded.length).toBe(4);
    expect(refundsExcluded.every((t) => t.refundLinked === false)).toBe(true);

    const bothOnly = await helpers.getTransactions({
      transferFilter: FILTER_OPERATION.only,
      refundFilter: FILTER_OPERATION.only,
      raw: true,
    });
    // Transfers OR refunds (not AND): transferIncome, transferExpense, refundOriginal, refundTx
    expect(bothOnly.length).toBe(4);
    expect(
      bothOnly.every((t) => t.transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer || t.refundLinked === true),
    ).toBe(true);

    const all = await helpers.getTransactions({ transferFilter: FILTER_OPERATION.all, raw: true });
    expect(all.length).toBe(6);

    const withoutRefundTxs = await helpers.getTransactions({
      excludeRefundTxs: true,
      excludeTransfer: true,
      raw: true,
    });
    const withoutRefundTxIds = withoutRefundTxs.map((t) => t.id);
    expect(withoutRefundTxIds).toContain(income.id);
    expect(withoutRefundTxIds).toContain(expense.id);
    expect(withoutRefundTxIds).toContain(refundOriginal.id);
    expect(withoutRefundTxIds).not.toContain(refundTx.id);
  }, 60_000);

  it('keepRefundsForTxId keeps refunds of that transaction only', async () => {
    const { refundOriginal, refundTx } = await createMockTransactions();

    const account = await helpers.createAccount({ raw: true });
    const [otherOriginal] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 700,
        transactionType: TRANSACTION_TYPES.income,
      }),
      raw: true,
    });
    const [otherRefund] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 700,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        refundForTxId: otherOriginal!.id,
      },
      raw: true,
    });
    const [orphanRefund] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 300,
        transactionType: TRANSACTION_TYPES.expense,
      }),
      raw: true,
    });
    await helpers.createSingleRefund({ originalTxId: null, refundTxId: orphanRefund!.id });

    const res = await helpers.getTransactions({
      excludeRefundTxs: true,
      keepRefundsForTxId: refundOriginal.id,
      raw: true,
    });

    const ids = res.map((t) => t.id);
    expect(ids).toContain(refundTx.id);
    expect(ids).toContain(otherOriginal!.id);
    expect(ids).not.toContain(otherRefund!.id);
    expect(ids).not.toContain(orphanRefund!.id);
  }, 60_000);

  it('filters and sorts the fixture by amount, account and time', async () => {
    const fixture = await createMockTransactions();
    const { income, expense } = fixture;

    const amountLte = await helpers.getTransactions({ amountLte: Money.fromDecimal(1000), raw: true });
    expect(amountLte.length).toBe(2); // refunds
    amountLte.forEach((tx) => {
      expect(tx.amount).toBeGreaterThanOrEqual(1000);
    });

    const amountGte = await helpers.getTransactions({ amountGte: Money.fromDecimal(5000), raw: true });
    expect(amountGte.length).toBe(2); // transfers
    amountGte.forEach((tx) => {
      expect(tx.amount).toBeGreaterThanOrEqual(5000);
    });

    const amountRange = await helpers.getTransactions({
      amountGte: Money.fromDecimal(2000),
      amountLte: Money.fromDecimal(5000),
      raw: true,
    });
    expect(amountRange.length).toBe(3); // income, expense, 1 of transfers
    amountRange.forEach((tx) => {
      expect(Number(tx.amount) >= 2000 && Number(tx.amount) <= 5000).toBe(true);
    });

    const byAccount = await helpers.getTransactions({ accountIds: [expense.accountId], raw: true });
    expect(byAccount.length).toBe(2); // expense, 1 of transfers
    expect(byAccount.every((t) => t.accountId === expense.accountId)).toBe(true);

    // accountA holds income, transferIncome, refundOriginal, refundTx; accountB holds expense, transferExpense.
    const withoutIncomeAccount = await helpers.getTransactions({ excludeAccountIds: [income.accountId], raw: true });
    expect(withoutIncomeAccount.length).toBe(2);
    expect(withoutIncomeAccount.every((t) => t.accountId !== income.accountId)).toBe(true);

    const withoutBothAccounts = await helpers.getTransactions({
      excludeAccountIds: [income.accountId, expense.accountId],
      raw: true,
    });
    expect(withoutBothAccounts.length).toBe(0);

    const unfiltered = await helpers.getTransactions({ raw: true });
    expect(unfiltered.length).toBe(6);

    const fixtureTimes = Object.values(fixture).map((t) => t!.time);
    for (const [direction, comparer] of [
      [SORT_DIRECTIONS.desc, compareDesc],
      [SORT_DIRECTIONS.asc, compareAsc],
    ] as const) {
      const sorted = await helpers.getTransactions({ order: direction, raw: true });
      expect(sorted.length).toBe(6);
      expect(fixtureTimes.toSorted((a, b) => comparer(new Date(a), new Date(b)))).toEqual(sorted.map((t) => t.time));
    }
  }, 60_000);

  describe('filter by note', () => {
    it('works correctly', async () => {
      const accountA = await helpers.createAccount({ raw: true });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: accountA.id,
          amount: 2000,
          transactionType: TRANSACTION_TYPES.income,
          note: 'test something test',
        }),
      });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: accountA.id,
          amount: 2000,
          transactionType: TRANSACTION_TYPES.income,
          note: 'test something test twice',
        }),
      });

      const res = (
        await Promise.all(
          ['something', 'SoMeThInG', 'test,twice', 'twice', 'random-text'].map((t) =>
            helpers.getTransactions({
              noteSearch: t,
              raw: true,
            }),
          ),
        )
      ).map((items) => items?.length ?? 0);

      expect(res).toEqual([
        2, // both transactions contain it
        2, // case-insinsitive
        2, // comma-separated, both have at aleast one value
        1, // only one contains it
        0, // none contain random one
      ]);

      const emptyParam = await helpers.getTransactions({ noteSearch: '' });
      expect(emptyParam.statusCode).toBe(200);
      expect(helpers.extractResponse(emptyParam!).length).toBe(2);

      const commaGarbage = await helpers.getTransactions({ noteSearch: ',,some,,' });
      expect(commaGarbage.statusCode).toBe(200);
      expect(helpers.extractResponse(commaGarbage!).length).toBe(2);
    });
  });

  describe('"blank" pseudo-id in list filters', () => {
    it('payeeIds: blank alone matches only transactions without a payee', async () => {
      const account = await helpers.createAccount({ raw: true });
      const payee = await helpers.createPayee({ payload: helpers.buildPayeePayload({ name: 'Shop' }), raw: true });
      const [withPayee] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, payeeId: payee.id }),
        raw: true,
      });
      const [withoutPayee] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });

      const blankOnly = await helpers.getTransactions({ payeeIds: [BLANK_FILTER_VALUE], raw: true });
      expect(sortedIds(blankOnly)).toEqual([withoutPayee.id]);

      const blankOrPayee = await helpers.getTransactions({ payeeIds: [BLANK_FILTER_VALUE, payee.id], raw: true });
      expect(sortedIds(blankOrPayee)).toEqual(sortedIds([withPayee, withoutPayee]));
    });

    it('budgetIds: blank matches rows in no tracker and ORs with real ids', async () => {
      const account = await helpers.createAccount({ raw: true });
      const [inBudget] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });
      const [unassigned] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });
      const budget = await helpers.createCustomBudget({ name: 'Trip', raw: true });
      await helpers.addTransactionToCustomBudget({
        id: budget.id,
        payload: { transactionIds: [inBudget.id] },
        raw: true,
      });

      const blankOnly = await helpers.getTransactions({ budgetIds: [BLANK_FILTER_VALUE], raw: true });
      expect(sortedIds(blankOnly)).toEqual([unassigned.id]);

      const blankOrBudget = await helpers.getTransactions({ budgetIds: [BLANK_FILTER_VALUE, budget.id], raw: true });
      expect(sortedIds(blankOrBudget)).toEqual(sortedIds([inBudget, unassigned]));
    });

    it('tagIds: blank matches untagged rows and ORs with real tag ids', async () => {
      const account = await helpers.createAccount({ raw: true });
      const tagA = await helpers.createTag({ payload: { name: 'A', color: '#ff0000' }, raw: true });
      const tagB = await helpers.createTag({ payload: { name: 'B', color: '#00ff00' }, raw: true });
      const [taggedA] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });
      const [taggedB] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });
      const [untagged] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });
      await helpers.addTransactionsToTag({ tagId: tagA.id, transactionIds: [taggedA.id], raw: true });
      await helpers.addTransactionsToTag({ tagId: tagB.id, transactionIds: [taggedA.id, taggedB.id], raw: true });

      const blankOnly = await helpers.getTransactions({ tagIds: [BLANK_FILTER_VALUE], raw: true });
      expect(sortedIds(blankOnly)).toEqual([untagged.id]);

      const blankOrA = await helpers.getTransactions({
        tagIds: [BLANK_FILTER_VALUE, tagA.id],
        includeTags: true,
        raw: true,
      });
      expect(sortedIds(blankOrA)).toEqual(sortedIds([taggedA, untagged]));
      expect(blankOrA.find((tx) => tx.id === taggedA.id)!.tags!.map((t) => t.id)).toEqual([tagA.id]);
      expect(blankOrA.find((tx) => tx.id === untagged.id)!.tags).toEqual([]);
    });

    it('rejects unknown pseudo-ids', async () => {
      for (const filters of [{ payeeIds: ['none'] }, { tagIds: ['none'] }]) {
        const res = await helpers.getTransactions(filters);
        expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
      }
    });
  });

  describe('sorting via sortBy + order', () => {
    it('sorts by refAmount in both directions', async () => {
      const account = await helpers.createAccount({ raw: true });

      for (const amount of [300, 100, 200]) {
        await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({ accountId: account.id, amount }),
          raw: true,
        });
      }

      const ascending = await helpers.getTransactions({
        sortBy: TRANSACTION_SORT_FIELD.refAmount,
        order: SORT_DIRECTIONS.asc,
        raw: true,
      });
      expect(ascending.map((tx) => Number(tx.refAmount))).toEqual([100, 200, 300]);

      const descending = await helpers.getTransactions({
        sortBy: TRANSACTION_SORT_FIELD.refAmount,
        order: SORT_DIRECTIONS.desc,
        raw: true,
      });
      expect(descending.map((tx) => Number(tx.refAmount))).toEqual([300, 200, 100]);
    });

    it('sorts by account name', async () => {
      const accountZ = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'zzz-account' }),
        raw: true,
      });
      const accountA = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'aaa-account' }),
        raw: true,
      });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: accountZ.id, amount: 100 }),
        raw: true,
      });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: accountA.id, amount: 100 }),
        raw: true,
      });

      const result = await helpers.getTransactions({
        sortBy: TRANSACTION_SORT_FIELD.accountName,
        order: SORT_DIRECTIONS.asc,
        raw: true,
      });

      expect(result.map((tx) => tx.accountId)).toEqual([accountA.id, accountZ.id]);
    });

    it('sorts by note and keeps blank notes last in both directions', async () => {
      const account = await helpers.createAccount({ raw: true });

      const [withA] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, note: 'aaa-note' }),
        raw: true,
      });
      const [withZ] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, note: 'zzz-note' }),
        raw: true,
      });
      const [emptyNote] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, note: '' }),
        raw: true,
      });
      const [noNote] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });

      const ascending = await helpers.getTransactions({
        sortBy: TRANSACTION_SORT_FIELD.note,
        order: SORT_DIRECTIONS.asc,
        raw: true,
      });
      expect(ascending.slice(0, 2).map((tx) => tx.id)).toEqual([withA.id, withZ.id]);
      expect(sortedIds(ascending.slice(2))).toEqual(sortedIds([emptyNote, noNote]));

      const descending = await helpers.getTransactions({
        sortBy: TRANSACTION_SORT_FIELD.note,
        order: SORT_DIRECTIONS.desc,
        raw: true,
      });
      expect(descending.slice(0, 2).map((tx) => tx.id)).toEqual([withZ.id, withA.id]);
      expect(sortedIds(descending.slice(2))).toEqual(sortedIds([emptyNote, noNote]));
    });
  });

  it('transferNatures filter selects natures and supersedes transferFilter', async () => {
    const { plain, outOfWallet, transferBase, transferOpposite } = await setupMixedNatures();

    const requested = await helpers.getTransactions({
      transferNatures: [TRANSACTION_TRANSFER_NATURE.not_transfer, TRANSACTION_TRANSFER_NATURE.transfer_out_wallet],
      raw: true,
    });
    const requestedIds = requested.map((tx) => tx.id);
    expect(requestedIds).toContain(plain.id);
    expect(requestedIds).toContain(outOfWallet.id);
    expect(requestedIds).not.toContain(transferBase.id);
    expect(requestedIds).not.toContain(transferOpposite!.id);

    const onlyCommon = await helpers.getTransactions({
      transferNatures: [TRANSACTION_TRANSFER_NATURE.common_transfer],
      raw: true,
    });
    const onlyCommonIds = onlyCommon.map((tx) => tx.id);
    expect(onlyCommonIds).toContain(transferBase.id);
    expect(onlyCommonIds).toContain(transferOpposite!.id);
    expect(onlyCommonIds).not.toContain(plain.id);
    expect(onlyCommonIds).not.toContain(outOfWallet.id);

    // transferFilter=exclude alone would drop transfers; the explicit natures list wins and keeps them.
    const withTransferFilter = await helpers.getTransactions({
      transferFilter: FILTER_OPERATION.exclude,
      transferNatures: [TRANSACTION_TRANSFER_NATURE.common_transfer],
      raw: true,
    });
    const withTransferFilterIds = withTransferFilter.map((tx) => tx.id);
    expect(withTransferFilterIds).toContain(transferBase.id);
    expect(withTransferFilterIds).not.toContain(plain.id);
  });

  it('excludeBalanceAdjustments hides only balance-adjustment rows', async () => {
    // One plain expense + one manual out-of-wallet transfer + one balance-adjustment
    // row (spawned by the balance-adjustment endpoint).
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ initialBalance: 1000 }),
      raw: true,
    });
    const [plain] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 100 }),
      raw: true,
    });
    const [manualOutOfWallet] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({ accountId: account.id, amount: 200 }),
        transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
      },
      raw: true,
    });
    const adjustmentResult = await helpers.balanceAdjustment({
      id: account.id,
      payload: { targetBalance: asDecimal(500) },
      raw: true,
    });
    const adjustment = adjustmentResult.transaction!;

    const excluded = await helpers.getTransactions({ excludeBalanceAdjustments: true, raw: true });
    const excludedIds = excluded.map((tx) => tx.id);
    expect(excludedIds).toContain(plain.id);
    expect(excludedIds).toContain(manualOutOfWallet.id);
    expect(excludedIds).not.toContain(adjustment.id);

    const flagOff = await helpers.getTransactions({ raw: true });
    const flagOffIds = flagOff.map((tx) => tx.id);
    expect(flagOffIds).toContain(plain.id);
    expect(flagOffIds).toContain(manualOutOfWallet.id);
    expect(flagOffIds).toContain(adjustment.id);

    const withNatures = await helpers.getTransactions({
      transferNatures: [TRANSACTION_TRANSFER_NATURE.transfer_out_wallet],
      excludeBalanceAdjustments: true,
      raw: true,
    });
    const withNaturesIds = withNatures.map((tx) => tx.id);
    expect(withNaturesIds).toContain(manualOutOfWallet.id);
    expect(withNaturesIds).not.toContain(plain.id);
    expect(withNaturesIds).not.toContain(adjustment.id);
  });

  it('rejects malformed query params', async () => {
    const fromAfterTo = await helpers.getTransactions({
      from: new Date().toISOString(),
      to: subDays(new Date(), 1).toISOString(),
      raw: false,
    });
    expect(fromAfterTo.statusCode).toEqual(ERROR_CODES.ValidationError);

    const invertedAmounts = await helpers.getTransactions({
      amountLte: Money.fromDecimal(2000),
      amountGte: Money.fromDecimal(5000),
    });
    expect(invertedAmounts.statusCode).toBe(ERROR_CODES.ValidationError);

    const noteSearchObject = await helpers.getTransactions({ noteSearch: {} as unknown as string });
    expect(noteSearchObject.statusCode).toBe(ERROR_CODES.ValidationError);

    const unknownSortBy = await helpers.makeRequest({
      method: 'get',
      url: '/transactions',
      payload: { sortBy: 'definitely-not-a-field' },
    });
    expect(unknownSortBy.statusCode).toBe(ERROR_CODES.ValidationError);

    const unknownNature = await helpers.makeRequest({
      method: 'get',
      url: '/transactions',
      payload: { transferNatures: 'not-a-real-nature' },
    });
    expect(unknownNature.statusCode).toBe(ERROR_CODES.ValidationError);

    const malformedStamp = await helpers.getTransactions({ categorizedAt: 'yesterday' });
    expect(malformedStamp.statusCode).toBe(ERROR_CODES.ValidationError);
  });
});

describe('GET /transactions — batchId filter', () => {
  const runCsvImport = async ({ accountId, currencyCode }: { accountId: string; currencyCode: string }) => {
    const { jobId } = await helpers.executeImport({
      payload: {
        fileContent: [
          'Date,Amount,Description,Category,Account,Currency,Type',
          `2024-01-15,10.00,Coffee,,A,${currencyCode},expense`,
          `2024-01-16,20.00,Lunch,,A,${currencyCode},expense`,
        ].join('\n'),
        delimiter: ',',
        columnMapping: {
          date: 'Date',
          dateFieldOrder: 'month-first',
          amount: 'Amount',
          description: 'Description',
          category: { option: CategoryOptionValue.mapDataSourceColumn, columnName: 'Category' },
          currency: { option: CurrencyOptionValue.dataSourceColumn, columnName: 'Currency' },
          transactionType: {
            option: TransactionTypeOptionValue.dataSourceColumn,
            columnName: 'Type',
            incomeValues: ['income'],
            expenseValues: ['expense'],
          },
          account: { option: AccountOptionValue.dataSourceColumn, columnName: 'Account' },
        },
        accountMapping: { A: { action: 'link-existing', accountId } },
        categoryMapping: {},
        skipDuplicateIndices: [],
      },
      raw: true,
    });
    const progress = await waitForCsvImportCompletion({ jobId });
    expectCsvImportCompleted(progress);
    return progress.summary;
  };

  it('returns only the transactions created by one import batch', async () => {
    const accountA = await helpers.createAccount({ raw: true });
    const accountB = await helpers.createAccount({ raw: true });
    const batchA = await runCsvImport({ accountId: accountA.id, currencyCode: accountA.currencyCode });
    const batchB = await runCsvImport({ accountId: accountB.id, currencyCode: accountB.currencyCode });

    const filtered = await helpers.getTransactions({ batchId: batchA.batchId, raw: true });

    expect(filtered).toHaveLength(2);
    expect(filtered.map((tx) => tx.id).toSorted()).toEqual(batchA.newTransactionIds.toSorted());
    expect(filtered.some((tx) => batchB.newTransactionIds.includes(tx.id))).toBe(false);

    const unknownBatch = await helpers.getTransactions({
      batchId: '00000000-0000-0000-0000-000000000000',
      raw: true,
    });
    expect(unknownBatch).toHaveLength(0);

    const malformedBatch = await helpers.getTransactions({ batchId: 'not-a-uuid' });
    expect(malformedBatch.statusCode).toBe(422);
  }, 60_000);

  it("does not return another user's batch, even when the batchId is known", async () => {
    const account = await helpers.createAccount({ raw: true });
    const batch = await runCsvImport({ accountId: account.id, currencyCode: account.currencyCode });

    const otherUser = await helpers.signUpSecondUser();
    const filteredAsOther = await helpers.asUser({
      cookies: otherUser.cookies,
      fn: () => helpers.getTransactions({ batchId: batch.batchId, raw: true }),
    });

    expect(filteredAsOther).toHaveLength(0);
  }, 60_000);
});

describe('GET /transactions — categorizedAt filter', () => {
  const RUN_SETTLE_TIMEOUT_MS = 15_000;
  const TEST_TIMEOUT_MS = 60_000;

  const seedTransactions = async ({
    count,
    categoryId,
    accountId,
  }: {
    count: number;
    categoryId: RecordId;
    accountId: RecordId;
  }): Promise<string[]> => {
    const today = startOfDay(new Date());
    const ids: string[] = [];

    for (let index = 0; index < count; index++) {
      const [transaction] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId,
          categoryId,
          amount: 100 + index,
          note: `Coffee shop ${index}`,
          time: subDays(today, index).toISOString(),
        }),
        raw: true,
      });
      ids.push(transaction.id);
    }

    return ids;
  };

  /** Returns the run's shared `categorizedAt` stamp. */
  const runCategorization = async (): Promise<string> => {
    const trigger = await helpers.triggerAiCategorization();
    expect(trigger.statusCode).toBe(200);

    await helpers.waitForCategorizationStatus({
      predicate: (status) => status.status === 'idle',
      timeoutMs: RUN_SETTLE_TIMEOUT_MS,
    });

    const history = await helpers.getAiCategorizationHistory({ raw: true });
    expect(history.items).toHaveLength(1);

    return history.items[0]!.categorizedAt;
  };

  let originalGeminiApiKey: string | undefined;

  beforeEach(() => {
    originalGeminiApiKey = process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    if (originalGeminiApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiApiKey;
    }
  });

  it(
    'returns exactly the transactions of the requested run, alone and combined with the source filter',
    async () => {
      process.env.GEMINI_API_KEY = VALID_GEMINI_API_KEY;
      global.mswMockServer.use(createGeminiMock({ categorizations: { 1: 1, 2: 1, 3: 1 } }));

      const user = await helpers.getUserInfo({ raw: true });
      const account = await helpers.createAccount({ raw: true });
      const seededIds = await seedTransactions({
        count: 3,
        categoryId: user.defaultCategoryId as RecordId,
        accountId: account.id,
      });

      const categorizedAt = await runCategorization();

      // Seeded after the run finished, so it can never carry the run's stamp.
      const [untouchedId] = await seedTransactions({
        count: 1,
        categoryId: user.defaultCategoryId as RecordId,
        accountId: account.id,
      });

      const runTransactions = await helpers.getTransactions({ categorizedAt, raw: true });
      expect(runTransactions.map((tx) => tx.id).sort()).toEqual([...seededIds].sort());
      expect(runTransactions.map((tx) => tx.id)).not.toContain(untouchedId);

      const runAndSource = await helpers.getTransactions({
        categorizedAt,
        categorizationSource: CATEGORIZATION_SOURCE.ai,
        raw: true,
      });
      expect(runAndSource.map((tx) => tx.id).sort()).toEqual([...seededIds].sort());

      const wrongSource = await helpers.getTransactions({
        categorizedAt,
        categorizationSource: CATEGORIZATION_SOURCE.manual,
        raw: true,
      });
      expect(wrongSource).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'stops matching a transaction the user re-categorized by hand',
    async () => {
      process.env.GEMINI_API_KEY = VALID_GEMINI_API_KEY;
      global.mswMockServer.use(createGeminiMock({ categorizations: { 1: 1, 2: 1 } }));

      const user = await helpers.getUserInfo({ raw: true });
      const account = await helpers.createAccount({ raw: true });
      const seededIds = await seedTransactions({
        count: 2,
        categoryId: user.defaultCategoryId as RecordId,
        accountId: account.id,
      });

      const categorizedAt = await runCategorization();

      const correction = await helpers.addCustomCategory({ name: 'Groceries', color: '#FF0000', raw: true });
      await helpers.updateTransaction({
        id: seededIds[0]! as RecordId,
        payload: { categoryId: correction.id },
        raw: true,
      });

      const runTransactions = await helpers.getTransactions({ categorizedAt, raw: true });
      expect(runTransactions.map((tx) => tx.id)).toEqual([seededIds[1]]);
    },
    TEST_TIMEOUT_MS,
  );
});
