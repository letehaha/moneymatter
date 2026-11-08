import { type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { addMonths, endOfMonth, format, setDate, startOfMonth } from 'date-fns';

const createTx = ({
  accountId,
  categoryId,
  amount,
  time,
  transactionType = TRANSACTION_TYPES.expense,
}: {
  accountId: RecordId;
  categoryId: RecordId;
  amount: number;
  time: string;
  transactionType?: TRANSACTION_TYPES;
}) =>
  helpers.createTransaction({
    payload: { ...helpers.buildTransactionPayload({ accountId, amount, categoryId, transactionType }), time },
    raw: true,
  });

const sumMonth = (categories: Record<string, { income: number; expense: number }>) =>
  Object.values(categories).reduce(
    (acc, curr) => ({ income: acc.income + curr.income, expense: acc.expense + curr.expense }),
    { income: 0, expense: 0 },
  );

describe('[Stats] Monthly spendings by categories', () => {
  it('splits income and expense per month and rolls each leg to its nearest selected category', async () => {
    const account = await helpers.createAccount({ raw: true });
    const categoriesList = await helpers.getCategoriesList();
    const rootCategory = categoriesList.find((c) => !c.parentId)!;
    const childCategory = categoriesList.find((c) => c.parentId === rootCategory.id)!;

    await Promise.all([
      createTx({ accountId: account.id, categoryId: rootCategory.id, amount: 100, time: '2025-01-15T12:00:00.000Z' }),
      createTx({ accountId: account.id, categoryId: childCategory.id, amount: 200, time: '2025-01-20T12:00:00.000Z' }),
      createTx({
        accountId: account.id,
        categoryId: childCategory.id,
        amount: 50,
        time: '2025-01-21T12:00:00.000Z',
        transactionType: TRANSACTION_TYPES.income,
      }),
      createTx({ accountId: account.id, categoryId: rootCategory.id, amount: 40, time: '2025-03-10T12:00:00.000Z' }),
    ]);

    const result = await helpers.getMonthlySpendingsByCategories({
      from: '2025-01-01',
      to: '2025-03-31',
      categoryIds: [rootCategory.id, childCategory.id],
      raw: true,
    });

    expect(result.map((entry) => entry.month)).toEqual(['2025-01', '2025-02', '2025-03']);

    const [january, february, march] = result;
    expect(january!.categories[rootCategory.id]).toMatchObject({ income: 0, expense: 100 });
    expect(january!.categories[childCategory.id]).toMatchObject({ income: 50, expense: 200 });
    expect(february!.categories[rootCategory.id]).toMatchObject({ income: 0, expense: 0 });
    expect(february!.categories[childCategory.id]).toMatchObject({ income: 0, expense: 0 });
    expect(march!.categories[rootCategory.id]).toMatchObject({ income: 0, expense: 40 });
    expect(march!.categories[childCategory.id]).toMatchObject({ income: 0, expense: 0 });
  });

  it('nets each side of a cross-month refund in its own transaction month', async () => {
    const account = await helpers.createAccount({ raw: true });
    const category = await helpers.addCustomCategory({
      name: `CrossMonthRefund-${generateRandomRecordId()}`,
      color: '#123123',
      raw: true,
    });

    const [expenseTx] = await createTx({
      accountId: account.id,
      categoryId: category.id,
      amount: 100,
      time: '2025-01-10T12:00:00.000Z',
    });
    const [refundTx] = await createTx({
      accountId: account.id,
      categoryId: category.id,
      amount: 30,
      time: '2025-02-05T12:00:00.000Z',
      transactionType: TRANSACTION_TYPES.income,
    });
    await helpers.createSingleRefund({ originalTxId: expenseTx!.id, refundTxId: refundTx!.id });

    const both = await helpers.getMonthlySpendingsByCategories({
      from: '2025-01-01',
      to: '2025-02-28',
      categoryIds: [category.id],
      raw: true,
    });
    expect(both[0]!.categories[category.id]).toMatchObject({ income: 0, expense: 70 });
    expect(both[1]!.categories[category.id]).toMatchObject({ income: 0, expense: 0 });

    const january = await helpers.getMonthlySpendingsByCategories({
      from: '2025-01-01',
      to: '2025-01-31',
      categoryIds: [category.id],
      raw: true,
    });
    expect(january[0]!.categories[category.id]).toMatchObject({ income: 0, expense: 70 });

    const february = await helpers.getMonthlySpendingsByCategories({
      from: '2025-02-01',
      to: '2025-02-28',
      categoryIds: [category.id],
      raw: true,
    });
    expect(february[0]!.categories[category.id]).toMatchObject({ income: 0, expense: 0 });

    const januaryTotals = await helpers.getSpendingsByCategories({
      from: '2025-01-01',
      to: '2025-01-31',
      categoryIds: [category.id],
      groupByType: true,
      raw: true,
    });
    expect(januaryTotals[category.id]).toMatchObject({ income: 0, expense: 70 });

    const februaryTotals = await helpers.getSpendingsByCategories({
      from: '2025-02-01',
      to: '2025-02-28',
      categoryIds: [category.id],
      groupByType: true,
      raw: true,
    });
    expect(februaryTotals[category.id]).toMatchObject({ income: 0, expense: 0 });
  });

  it('returns every month of the range with zeroed selected categories when there is no data', async () => {
    const categoriesList = await helpers.getCategoriesList();
    const category = categoriesList.find((c) => !c.parentId)!;

    const result = await helpers.getMonthlySpendingsByCategories({
      from: '2025-05-01',
      to: '2025-06-30',
      categoryIds: [category.id],
      raw: true,
    });

    expect(result).toEqual([
      {
        month: '2025-05',
        categories: { [category.id]: { name: category.name, color: category.color, income: 0, expense: 0 } },
      },
      {
        month: '2025-06',
        categories: { [category.id]: { name: category.name, color: category.color, income: 0, expense: 0 } },
      },
    ]);
  });

  it('counts planned transactions by default and drops them with excludePlanned=true', async () => {
    const account = await helpers.createAccount({ raw: true });
    const nextMonth = addMonths(new Date(), 1);

    await helpers.createPlannedTransaction({
      payload: {
        accountId: account.id,
        amount: 30,
        transactionType: TRANSACTION_TYPES.expense,
        time: setDate(nextMonth, 15).toISOString(),
      },
      raw: true,
    });

    const range = {
      from: format(startOfMonth(nextMonth), 'yyyy-MM-dd'),
      to: format(endOfMonth(nextMonth), 'yyyy-MM-dd'),
    };

    const included = await helpers.getMonthlySpendingsByCategories({ ...range, raw: true });
    const excluded = await helpers.getMonthlySpendingsByCategories({ ...range, excludePlanned: true, raw: true });

    expect(sumMonth(included[0]!.categories).expense).toBe(30);
    expect(sumMonth(excluded[0]!.categories).expense).toBe(0);
  });

  it('rejects a missing or inverted range with 422', async () => {
    const missingFrom = await helpers.makeRequest({
      method: 'get',
      url: '/stats/spendings-by-categories/monthly?to=2025-12-31',
    });
    expect(missingFrom.statusCode).toBe(422);

    const inverted = await helpers.getMonthlySpendingsByCategories({ from: '2025-12-31', to: '2025-01-01' });
    expect(inverted.statusCode).toBe(422);
  });
});
