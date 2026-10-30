import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

const uniqueName = (prefix: string): string => `${prefix}-${generateRandomRecordId()}`;

describe('GET /stats/pivot', () => {
  it('happy path: expenses by category across yearly buckets', async () => {
    const account = await helpers.createAccount({ raw: true });
    const category = await helpers.addCustomCategory({ name: uniqueName('Groceries'), color: '#112233', raw: true });

    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
        }),
        time: '2024-06-15T12:00:00.000Z',
      },
      raw: true,
    });
    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 150,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
        }),
        time: '2025-06-15T12:00:00.000Z',
      },
      raw: true,
    });

    const result = await helpers.getPivotReport({
      from: '2024-01-01',
      to: '2025-12-31',
      granularity: 'yearly',
      rowDimension: 'category',
      measure: 'expense',
      raw: true,
    });

    expect(result.columns.map((column) => column.key)).toEqual(['2024', '2025']);
    expect(result.currencyCode).toBe(global.BASE_CURRENCY!.code);

    const row = result.rows.find((candidate) => candidate.id === category.id);
    expect(row).toBeDefined();
    expect(row!.kind).toBe('flat');
    // Amounts come back as DECIMALS (1:1 with the amounts we sent on a base-currency account).
    expect(row!.values['2024']).toBe(100);
    expect(row!.values['2025']).toBe(150);
    expect(row!.total).toBe(250);

    expect(result.columnTotals['2024']).toBe(100);
    expect(result.columnTotals['2025']).toBe(150);
    expect(result.grandTotal).toBe(250);
  });

  it('empty state: no transactions yields no rows but columns are still present', async () => {
    const result = await helpers.getPivotReport({
      from: '2025-01-01',
      to: '2025-03-31',
      granularity: 'monthly',
      rowDimension: 'category',
      measure: 'expense',
      raw: true,
    });

    expect(result.rows).toHaveLength(0);
    expect(result.grandTotal).toBe(0);
    expect(result.columns.map((column) => column.key)).toEqual(['2025-01', '2025-02', '2025-03']);
  });

  it('rejects an invalid granularity, rowDimension, measure or range with 422', async () => {
    const invalidGranularity = await helpers.makeRequest({
      method: 'get',
      url: '/stats/pivot?from=2025-01-01&to=2025-12-31&granularity=daily&rowDimension=category&measure=expense',
    });
    expect(invalidGranularity.statusCode).toBe(422);

    const invalidRowDimension = await helpers.makeRequest({
      method: 'get',
      url: '/stats/pivot?from=2025-01-01&to=2025-12-31&granularity=monthly&rowDimension=merchant&measure=expense',
    });
    expect(invalidRowDimension.statusCode).toBe(422);

    const invalidMeasure = await helpers.makeRequest({
      method: 'get',
      url: '/stats/pivot?from=2025-01-01&to=2025-12-31&granularity=monthly&rowDimension=category&measure=savings',
    });
    expect(invalidMeasure.statusCode).toBe(422);

    const invertedRange = await helpers.getPivotReport({
      from: '2025-12-31',
      to: '2025-01-01',
      granularity: 'monthly',
      rowDimension: 'category',
      measure: 'expense',
    });
    expect(invertedRange.statusCode).toBe(422);

    const emptyFrom = await helpers.makeRequest({
      method: 'get',
      url: '/stats/pivot?from=&to=2025-12-31&granularity=monthly&rowDimension=category&measure=expense',
    });
    expect(emptyFrom.statusCode).toBe(422);

    const malformedTo = await helpers.makeRequest({
      method: 'get',
      url: '/stats/pivot?from=2025-01-01&to=nonsense&granularity=monthly&rowDimension=category&measure=expense',
    });
    expect(malformedTo.statusCode).toBe(422);
  });

  it('accuracy: a split transaction distributes across two category rows in the same bucket', async () => {
    const account = await helpers.createAccount({ raw: true });
    const primaryCategory = await helpers.addCustomCategory({
      name: uniqueName('Primary'),
      color: '#aa0000',
      raw: true,
    });
    const splitCategory = await helpers.addCustomCategory({ name: uniqueName('Split'), color: '#00aa00', raw: true });

    // $100 expense on Primary with a $30 split to the Split category => Primary 70, Split 30.
    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: primaryCategory.id,
          splits: [{ categoryId: splitCategory.id, amount: 30 }],
        }),
        time: '2025-02-10T12:00:00.000Z',
      },
      raw: true,
    });

    const result = await helpers.getPivotReport({
      from: '2025-01-01',
      to: '2025-03-31',
      granularity: 'monthly',
      rowDimension: 'category',
      measure: 'expense',
      raw: true,
    });

    const primaryRow = result.rows.find((row) => row.id === primaryCategory.id);
    const splitRow = result.rows.find((row) => row.id === splitCategory.id);

    expect(primaryRow!.values['2025-02']).toBe(70);
    expect(primaryRow!.total).toBe(70);
    expect(splitRow!.values['2025-02']).toBe(30);
    expect(splitRow!.total).toBe(30);
    expect(result.columnTotals['2025-02']).toBe(100);
    expect(result.grandTotal).toBe(100);
  });

  it('accuracy: a refund reduces the category bucket it lands in', async () => {
    const account = await helpers.createAccount({ raw: true });
    const category = await helpers.addCustomCategory({ name: uniqueName('Refundable'), color: '#0000aa', raw: true });

    const [expenseTx] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
        }),
        time: '2025-01-10T12:00:00.000Z',
      },
      raw: true,
    });
    const [refundTx] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 30,
          transactionType: TRANSACTION_TYPES.income,
          categoryId: category.id,
        }),
        time: '2025-01-20T12:00:00.000Z',
      },
      raw: true,
    });
    await helpers.createSingleRefund({ originalTxId: expenseTx.id, refundTxId: refundTx.id });

    const result = await helpers.getPivotReport({
      from: '2025-01-01',
      to: '2025-01-31',
      granularity: 'monthly',
      rowDimension: 'category',
      measure: 'expense',
      raw: true,
    });

    const row = result.rows.find((candidate) => candidate.id === category.id);
    expect(row!.values['2025-01']).toBe(70); // 100 expense - 30 refund
    expect(row!.total).toBe(70);
    expect(result.grandTotal).toBe(70);
  });

  it('payee dimension: groups by payee, adds an Unassigned row, and narrows to payeeIds', async () => {
    const account = await helpers.createAccount({ raw: true });
    const payeeA = await helpers.createPayee({ payload: { name: uniqueName('Acme') }, raw: true });
    const payeeB = await helpers.createPayee({ payload: { name: uniqueName('PayeeB') }, raw: true });

    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 40,
          transactionType: TRANSACTION_TYPES.expense,
          payeeId: payeeA.id,
        }),
        time: '2025-02-05T12:00:00.000Z',
      },
      raw: true,
    });
    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 25,
          transactionType: TRANSACTION_TYPES.expense,
          payeeId: payeeB.id,
        }),
        time: '2025-02-06T12:00:00.000Z',
      },
      raw: true,
    });
    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 15,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        time: '2025-02-07T12:00:00.000Z',
      },
      raw: true,
    });

    const result = await helpers.getPivotReport({
      from: '2025-02-01',
      to: '2025-02-28',
      granularity: 'monthly',
      rowDimension: 'payee',
      measure: 'expense',
      raw: true,
    });

    const payeeRow = result.rows.find((row) => row.id === payeeA.id);
    expect(payeeRow).toBeDefined();
    expect(payeeRow!.label).toBe(payeeA.name);
    expect(payeeRow!.color).toBeNull();
    expect(payeeRow!.total).toBe(40);

    const unassignedRow = result.rows.find((row) => row.id === 'unassigned');
    expect(unassignedRow).toBeDefined();
    expect(unassignedRow!.label).toBe('Unassigned');
    expect(unassignedRow!.total).toBe(15);

    expect(result.grandTotal).toBe(80);

    // `payeeId IN (…)` never matches a null payee, so the filtered report is payee A alone.
    const filtered = await helpers.getPivotReport({
      from: '2025-02-01',
      to: '2025-02-28',
      granularity: 'monthly',
      rowDimension: 'payee',
      measure: 'expense',
      payeeIds: [payeeA.id],
      raw: true,
    });

    const filteredRowA = filtered.rows.find((row) => row.id === payeeA.id);
    expect(filteredRowA).toBeDefined();
    expect(filteredRowA!.label).toBe(payeeA.name);
    expect(filteredRowA!.total).toBe(40);
    expect(filtered.rows.find((row) => row.id === payeeB.id)).toBeUndefined();
    expect(filtered.grandTotal).toBe(40);
  }, 60_000);

  it('payee dimension: surfaces each payee logo (domain, monogram, or null)', async () => {
    const account = await helpers.createAccount({ raw: true });
    const withLogo = await helpers.createPayee({
      payload: helpers.buildPayeePayload({ name: uniqueName('Netflix'), logoDomain: 'netflix.com' }),
      raw: true,
    });
    const withoutLogo = await helpers.createPayee({
      payload: helpers.buildPayeePayload({ name: uniqueName('Corner Shop') }),
      raw: true,
    });
    const withMonogram = await helpers.createPayee({
      payload: helpers.buildPayeePayload({
        name: uniqueName('Local Bakery'),
        logoInitials: 'LB',
        logoColor: '#7355be',
      }),
      raw: true,
    });

    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 40,
          transactionType: TRANSACTION_TYPES.expense,
          payeeId: withLogo.id,
        }),
        time: '2025-10-05T12:00:00.000Z',
      },
      raw: true,
    });
    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 25,
          transactionType: TRANSACTION_TYPES.expense,
          payeeId: withoutLogo.id,
        }),
        time: '2025-10-06T12:00:00.000Z',
      },
      raw: true,
    });
    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 10,
          transactionType: TRANSACTION_TYPES.expense,
          payeeId: withMonogram.id,
        }),
        time: '2025-10-07T12:00:00.000Z',
      },
      raw: true,
    });

    const result = await helpers.getPivotReport({
      from: '2025-10-01',
      to: '2025-10-31',
      granularity: 'monthly',
      rowDimension: 'payee',
      measure: 'expense',
      raw: true,
    });

    const logoRow = result.rows.find((row) => row.id === withLogo.id);
    expect(logoRow!.logoDomain).toBe('netflix.com');

    const plainRow = result.rows.find((row) => row.id === withoutLogo.id);
    expect(plainRow!.logoDomain).toBeNull();
    expect(plainRow!.logoInitials).toBeNull();

    const monogramRow = result.rows.find((row) => row.id === withMonogram.id);
    expect(monogramRow!.logoInitials).toBe('LB');
    expect(monogramRow!.logoColor).toBe('#7355be');
    expect(monogramRow!.logoDomain).toBeNull();

    // The residual Unassigned bucket is not a real payee, so it carries no logoDomain field.
    const unassignedRow = result.rows.find((row) => row.id === 'unassigned');
    expect(unassignedRow).toBeUndefined();
  });

  it('tag dimension: a two-tag transaction fans into both rows plus an Untagged row', async () => {
    const account = await helpers.createAccount({ raw: true });
    const tagA = await helpers.createTag({ payload: { name: uniqueName('TagA'), color: '#ff0000' }, raw: true });
    const tagB = await helpers.createTag({ payload: { name: uniqueName('TagB'), color: '#00ff00' }, raw: true });

    const [taggedTx] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 50,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        time: '2025-03-10T12:00:00.000Z',
      },
      raw: true,
    });
    await helpers.addTransactionsToTag({ tagId: tagA.id, transactionIds: [taggedTx.id] });
    await helpers.addTransactionsToTag({ tagId: tagB.id, transactionIds: [taggedTx.id] });

    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 20,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        time: '2025-03-11T12:00:00.000Z',
      },
      raw: true,
    });

    const result = await helpers.getPivotReport({
      from: '2025-03-01',
      to: '2025-03-31',
      granularity: 'monthly',
      rowDimension: 'tag',
      measure: 'expense',
      raw: true,
    });

    const rowA = result.rows.find((row) => row.id === tagA.id);
    const rowB = result.rows.find((row) => row.id === tagB.id);
    const untaggedRow = result.rows.find((row) => row.id === 'untagged');

    expect(rowA!.total).toBe(50);
    expect(rowA!.color).toBe('#ff0000');
    expect(rowB!.total).toBe(50);
    expect(untaggedRow!.total).toBe(20);
    expect(untaggedRow!.label).toBe('Untagged');

    // The two-tag tx is double counted across its tag rows (expected fan-out).
    expect(result.grandTotal).toBe(120);
  });

  it('subcategory dimension: parent row rolls up its children', async () => {
    const account = await helpers.createAccount({ raw: true });
    const parent = await helpers.addCustomCategory({ name: uniqueName('ParentCat'), color: '#334455', raw: true });
    const child = await helpers.addCustomCategory({
      name: uniqueName('ChildCat'),
      color: '#556677',
      parentId: parent.id,
      raw: true,
    });

    // $60 directly on the parent + $40 on the child => parent rollup 100, child 40.
    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 60,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: parent.id,
        }),
        time: '2025-01-10T12:00:00.000Z',
      },
      raw: true,
    });
    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 40,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: child.id,
        }),
        time: '2025-01-12T12:00:00.000Z',
      },
      raw: true,
    });

    const result = await helpers.getPivotReport({
      from: '2025-01-01',
      to: '2025-01-31',
      granularity: 'monthly',
      rowDimension: 'subcategory',
      measure: 'expense',
      raw: true,
    });

    const parentRow = result.rows.find((row) => row.id === parent.id);
    const childRow = result.rows.find((row) => row.id === child.id);

    expect(parentRow!.kind).toBe('parent');
    expect(parentRow!.parentId).toBeNull();
    expect(parentRow!.total).toBe(100); // 60 own + 40 child

    expect(childRow!.kind).toBe('child');
    expect(childRow!.parentId).toBe(parent.id);
    expect(childRow!.total).toBe(40);

    // Column totals sum only top-level rows, so the child is not double counted.
    expect(result.columnTotals['2025-01']).toBe(100);
    expect(result.grandTotal).toBe(100);
  });

  it('income measure: groups income into category rows and ignores expenses', async () => {
    const account = await helpers.createAccount({ raw: true });
    const category = await helpers.addCustomCategory({ name: uniqueName('Salary'), color: '#00ff88', raw: true });

    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 200,
          transactionType: TRANSACTION_TYPES.income,
          categoryId: category.id,
        }),
        time: '2024-06-15T12:00:00.000Z',
      },
      raw: true,
    });
    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 300,
          transactionType: TRANSACTION_TYPES.income,
          categoryId: category.id,
        }),
        time: '2025-06-15T12:00:00.000Z',
      },
      raw: true,
    });
    // An expense on the same category must not leak into an income report.
    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 999,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
        }),
        time: '2024-06-16T12:00:00.000Z',
      },
      raw: true,
    });

    const result = await helpers.getPivotReport({
      from: '2024-01-01',
      to: '2025-12-31',
      granularity: 'yearly',
      rowDimension: 'category',
      measure: 'income',
      raw: true,
    });

    const row = result.rows.find((candidate) => candidate.id === category.id);
    expect(row).toBeDefined();
    expect(row!.values['2024']).toBe(200);
    expect(row!.values['2025']).toBe(300);
    expect(row!.total).toBe(500);

    expect(result.columnTotals['2024']).toBe(200);
    expect(result.columnTotals['2025']).toBe(300);
    expect(result.grandTotal).toBe(500);
  });

  it('categoryIds filter expands to descendants: filtering by a parent catches child spend', async () => {
    const account = await helpers.createAccount({ raw: true });
    const parent = await helpers.addCustomCategory({ name: uniqueName('Travel'), color: '#123456', raw: true });
    const child = await helpers.addCustomCategory({
      name: uniqueName('Flights'),
      color: '#654321',
      parentId: parent.id,
      raw: true,
    });

    // Spend only on the CHILD category.
    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 80,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: child.id,
        }),
        time: '2025-04-10T12:00:00.000Z',
      },
      raw: true,
    });

    // Filter by the PARENT id — descendant expansion must pull in the child transaction.
    const result = await helpers.getPivotReport({
      from: '2025-04-01',
      to: '2025-04-30',
      granularity: 'monthly',
      rowDimension: 'subcategory',
      measure: 'expense',
      categoryIds: [parent.id],
      raw: true,
    });

    const parentRow = result.rows.find((row) => row.id === parent.id);
    const childRow = result.rows.find((row) => row.id === child.id);

    expect(parentRow).toBeDefined();
    expect(parentRow!.kind).toBe('parent');
    expect(parentRow!.total).toBe(80); // rolled up from the child
    expect(childRow).toBeDefined();
    expect(childRow!.parentId).toBe(parent.id);
    expect(childRow!.total).toBe(80);
    expect(result.grandTotal).toBe(80);
  });

  it('excludeFromStats and accountIds each narrow the accounts the report reads', async () => {
    const accountA = await helpers.createAccount({ raw: true });
    const accountB = await helpers.createAccount({ raw: true });
    const excludedAccount = await helpers.createAccount({ raw: true });
    await helpers.updateAccount({ id: excludedAccount.id, payload: { excludeFromStats: true }, raw: true });

    const categoryA = await helpers.addCustomCategory({ name: uniqueName('CatA'), color: '#0a0a0a', raw: true });
    const categoryB = await helpers.addCustomCategory({ name: uniqueName('CatB'), color: '#0b0b0b', raw: true });
    const excludedCategory = await helpers.addCustomCategory({
      name: uniqueName('Skipped'),
      color: '#0c0c0c',
      raw: true,
    });

    for (const [accountId, amount, categoryId] of [
      [accountA.id, 100, categoryA.id],
      [accountB.id, 50, categoryB.id],
      [excludedAccount.id, 70, excludedCategory.id],
    ] as const) {
      await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId,
            amount,
            transactionType: TRANSACTION_TYPES.expense,
            categoryId,
          }),
          time: '2025-05-10T12:00:00.000Z',
        },
        raw: true,
      });
    }

    const unfiltered = await helpers.getPivotReport({
      from: '2025-05-01',
      to: '2025-05-31',
      granularity: 'monthly',
      rowDimension: 'category',
      measure: 'expense',
      raw: true,
    });

    expect(unfiltered.rows.find((row) => row.id === categoryA.id)!.total).toBe(100);
    expect(unfiltered.rows.find((row) => row.id === categoryB.id)!.total).toBe(50);
    expect(unfiltered.rows.find((row) => row.id === excludedCategory.id)).toBeUndefined();
    expect(unfiltered.grandTotal).toBe(150);

    const scopedToA = await helpers.getPivotReport({
      from: '2025-05-01',
      to: '2025-05-31',
      granularity: 'monthly',
      rowDimension: 'category',
      measure: 'expense',
      accountIds: [accountA.id],
      raw: true,
    });

    expect(scopedToA.rows.find((row) => row.id === categoryA.id)!.total).toBe(100);
    expect(scopedToA.rows.find((row) => row.id === categoryB.id)).toBeUndefined();
    expect(scopedToA.grandTotal).toBe(100);
  }, 60_000);

  it('transfer exclusion: transfer legs never appear in the report', async () => {
    const source = await helpers.createAccount({ raw: true });
    const destination = await helpers.createAccount({ raw: true });
    const category = await helpers.addCustomCategory({ name: uniqueName('Regular'), color: '#abcabc', raw: true });

    // A transfer between two of the user's accounts (both legs carry a non-`not_transfer` nature).
    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: source.id,
          amount: 500,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAmount: 500,
          destinationAccountId: destination.id,
        }),
        time: '2025-06-10T12:00:00.000Z',
      },
      raw: true,
    });

    // A plain expense so the report is non-empty and we can assert only it is counted.
    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: source.id,
          amount: 40,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
        }),
        time: '2025-06-12T12:00:00.000Z',
      },
      raw: true,
    });

    const result = await helpers.getPivotReport({
      from: '2025-06-01',
      to: '2025-06-30',
      granularity: 'monthly',
      rowDimension: 'category',
      measure: 'expense',
      raw: true,
    });

    // Only the plain expense is present; neither leg of the 500 transfer is counted.
    expect(result.rows.find((row) => row.id === category.id)!.total).toBe(40);
    expect(result.grandTotal).toBe(40);
  });

  it('cross-bucket refund: a refund nets into its own month, pushing that bucket negative', async () => {
    const account = await helpers.createAccount({ raw: true });
    const category = await helpers.addCustomCategory({ name: uniqueName('Returns'), color: '#0000ff', raw: true });

    // $100 expense in January.
    const [expenseTx] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
        }),
        time: '2025-01-10T12:00:00.000Z',
      },
      raw: true,
    });
    // $30 refund in February — no other February expense sits on this category.
    const [refundTx] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 30,
          transactionType: TRANSACTION_TYPES.income,
          categoryId: category.id,
        }),
        time: '2025-02-20T12:00:00.000Z',
      },
      raw: true,
    });
    await helpers.createSingleRefund({ originalTxId: expenseTx.id, refundTxId: refundTx.id });

    const result = await helpers.getPivotReport({
      from: '2025-01-01',
      to: '2025-02-28',
      granularity: 'monthly',
      rowDimension: 'category',
      measure: 'expense',
      raw: true,
    });

    const row = result.rows.find((candidate) => candidate.id === category.id);
    expect(row).toBeDefined();
    expect(row!.values['2025-01']).toBe(100); // expense stays in January
    expect(row!.values['2025-02']).toBe(-30); // refund buckets into February, going negative
    expect(row!.total).toBe(70);

    expect(result.columnTotals['2025-01']).toBe(100);
    expect(result.columnTotals['2025-02']).toBe(-30);
    expect(result.grandTotal).toBe(70);
  });

  it('cross-currency: row values use the base-currency refAmount, not the raw foreign amount', async () => {
    // A foreign-currency (UAH) account with an explicit UAH->base rate of 0.1, so a 1000 UAH
    // expense is worth 100 in the base currency. Summing the raw `amount` (1000) instead of the
    // rate-converted `refAmount` (100) — the exact regression this guards against — would fail
    // every assertion below.
    const { account, currency } = await helpers.createAccountWithNewCurrency({ currency: 'UAH' });
    const category = await helpers.addCustomCategory({ name: uniqueName('Foreign'), color: '#778899', raw: true });

    await helpers.editUserCurrencyExchangeRate({
      pairs: [
        { baseCode: currency.code, quoteCode: global.BASE_CURRENCY!.code, rate: 0.1 },
        { baseCode: global.BASE_CURRENCY!.code, quoteCode: currency.code, rate: 10 },
      ],
    });

    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1000, // 1000 UAH
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
        }),
        time: '2025-03-15T12:00:00.000Z',
      },
      raw: true,
    });

    const result = await helpers.getPivotReport({
      from: '2025-03-01',
      to: '2025-03-31',
      granularity: 'monthly',
      rowDimension: 'category',
      measure: 'expense',
      raw: true,
    });

    const row = result.rows.find((candidate) => candidate.id === category.id);
    expect(row).toBeDefined();
    // 1000 UAH * 0.1 = 100 base currency — NOT the raw 1000 foreign amount.
    expect(row!.values['2025-03']).toBe(100);
    expect(row!.total).toBe(100);
    expect(result.columnTotals['2025-03']).toBe(100);
    expect(result.grandTotal).toBe(100);
    expect(result.currencyCode).toBe(global.BASE_CURRENCY!.code);
  });

  it('split-targeted refund: nets only the split category, leaving the primary untouched', async () => {
    const account = await helpers.createAccount({ raw: true });
    const primaryCategory = await helpers.addCustomCategory({
      name: uniqueName('SplitPrimary'),
      color: '#aa1100',
      raw: true,
    });
    const splitCategory = await helpers.addCustomCategory({
      name: uniqueName('SplitTarget'),
      color: '#0011aa',
      raw: true,
    });

    // $100 expense on Primary with a $30 split to the Split category => Primary 70, Split 30.
    const [expenseTx] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: primaryCategory.id,
          splits: [{ categoryId: splitCategory.id, amount: 30 }],
        }),
        time: '2025-09-10T12:00:00.000Z',
      },
      raw: true,
    });

    // Resolve the split id so the refund can be linked to that exact split.
    const allTransactions = (await helpers.getTransactions({ raw: true, includeSplits: true }))!;
    const expenseWithSplits = allTransactions.find((tx) => tx.id === expenseTx.id)!;
    const targetSplit = expenseWithSplits.splits![0]!;

    // $20 refund (income) on the split's category, linked to the split.
    const [refundTx] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 20,
          transactionType: TRANSACTION_TYPES.income,
          categoryId: splitCategory.id,
        }),
        time: '2025-09-20T12:00:00.000Z',
      },
      raw: true,
    });
    await helpers.createSingleRefund({ originalTxId: expenseTx.id, refundTxId: refundTx.id, splitId: targetSplit.id });

    const result = await helpers.getPivotReport({
      from: '2025-09-01',
      to: '2025-09-30',
      granularity: 'monthly',
      rowDimension: 'category',
      measure: 'expense',
      raw: true,
    });

    const primaryRow = result.rows.find((row) => row.id === primaryCategory.id);
    const splitRow = result.rows.find((row) => row.id === splitCategory.id);

    // The split-targeted refund must reduce ONLY the split's category, never the primary.
    expect(primaryRow!.values['2025-09']).toBe(70);
    expect(primaryRow!.total).toBe(70);
    expect(splitRow!.values['2025-09']).toBe(10); // 30 split - 20 refund
    expect(splitRow!.total).toBe(10);
    expect(result.grandTotal).toBe(80);
  });

  it('weekly and quarterly granularity: transactions land in adjacent columns', async () => {
    const account = await helpers.createAccount({ raw: true });
    const category = await helpers.addCustomCategory({ name: uniqueName('Buckets'), color: '#121212', raw: true });

    // 2025-01-06 and 2025-01-13 are consecutive Mondays (weeks start on Monday).
    for (const [amount, time] of [
      [100, '2025-01-08T12:00:00.000Z'], // week of 2025-01-06, Q1
      [250, '2025-01-15T12:00:00.000Z'], // week of 2025-01-13, Q1
      [100, '2025-02-15T12:00:00.000Z'], // Q1 2025
      [300, '2025-05-15T12:00:00.000Z'], // Q2 2025
    ] as const) {
      await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: account.id,
            amount,
            transactionType: TRANSACTION_TYPES.expense,
            categoryId: category.id,
          }),
          time,
        },
        raw: true,
      });
    }

    const weekly = await helpers.getPivotReport({
      from: '2025-01-06',
      to: '2025-01-19',
      granularity: 'weekly',
      rowDimension: 'category',
      measure: 'expense',
      raw: true,
    });

    expect(weekly.columns.map((column) => column.key)).toEqual(['2025-01-06', '2025-01-13']);
    expect(weekly.columns.map((column) => column.label)).toEqual(['Wk of 2025-01-06', 'Wk of 2025-01-13']);

    const weeklyRow = weekly.rows.find((candidate) => candidate.id === category.id);
    expect(weeklyRow!.values['2025-01-06']).toBe(100);
    expect(weeklyRow!.values['2025-01-13']).toBe(250);
    expect(weeklyRow!.total).toBe(350);
    expect(weekly.columnTotals['2025-01-06']).toBe(100);
    expect(weekly.columnTotals['2025-01-13']).toBe(250);
    expect(weekly.grandTotal).toBe(350);

    const quarterly = await helpers.getPivotReport({
      from: '2025-01-01',
      to: '2025-06-30',
      granularity: 'quarterly',
      rowDimension: 'category',
      measure: 'expense',
      raw: true,
    });

    expect(quarterly.columns.map((column) => column.key)).toEqual(['2025-Q1', '2025-Q2']);
    expect(quarterly.columns.map((column) => column.label)).toEqual(['Q1 2025', 'Q2 2025']);

    const quarterlyRow = quarterly.rows.find((candidate) => candidate.id === category.id);
    // Q1 holds the two January transactions plus the February one.
    expect(quarterlyRow!.values['2025-Q1']).toBe(450);
    expect(quarterlyRow!.values['2025-Q2']).toBe(300);
    expect(quarterlyRow!.total).toBe(750);
    expect(quarterly.columnTotals['2025-Q1']).toBe(450);
    expect(quarterly.columnTotals['2025-Q2']).toBe(300);
    expect(quarterly.grandTotal).toBe(750);
  }, 60_000);

  it('payee dimension: nets a refund against the original expense payee', async () => {
    const account = await helpers.createAccount({ raw: true });
    const payee = await helpers.createPayee({ payload: { name: uniqueName('Refundee') }, raw: true });

    const [expenseTx] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          payeeId: payee.id,
        }),
        time: '2025-04-10T12:00:00.000Z',
      },
      raw: true,
    });
    const [refundTx] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 30,
          transactionType: TRANSACTION_TYPES.income,
          payeeId: payee.id,
        }),
        time: '2025-04-20T12:00:00.000Z',
      },
      raw: true,
    });
    await helpers.createSingleRefund({ originalTxId: expenseTx.id, refundTxId: refundTx.id });

    const result = await helpers.getPivotReport({
      from: '2025-04-01',
      to: '2025-04-30',
      granularity: 'monthly',
      rowDimension: 'payee',
      measure: 'expense',
      raw: true,
    });

    // A refunded amount is not spend, so the payee dimension nets it just like categories do.
    const row = result.rows.find((candidate) => candidate.id === payee.id);
    expect(row!.values['2025-04']).toBe(70); // 100 expense - 30 refund
    expect(row!.total).toBe(70);
    expect(result.grandTotal).toBe(70);
  });

  it('tag dimension: nets a refund across the original expense tags', async () => {
    const account = await helpers.createAccount({ raw: true });
    const tag = await helpers.createTag({ payload: { name: uniqueName('Refundable'), color: '#abcdef' }, raw: true });

    const [expenseTx] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 80,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        time: '2025-05-10T12:00:00.000Z',
      },
      raw: true,
    });
    await helpers.addTransactionsToTag({ tagId: tag.id, transactionIds: [expenseTx.id] });

    const [refundTx] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 30,
          transactionType: TRANSACTION_TYPES.income,
        }),
        time: '2025-05-20T12:00:00.000Z',
      },
      raw: true,
    });
    await helpers.createSingleRefund({ originalTxId: expenseTx.id, refundTxId: refundTx.id });

    const result = await helpers.getPivotReport({
      from: '2025-05-01',
      to: '2025-05-31',
      granularity: 'monthly',
      rowDimension: 'tag',
      measure: 'expense',
      raw: true,
    });

    // The refund reduces the same tag row the expense filled (attributed to the expense's tags).
    const row = result.rows.find((candidate) => candidate.id === tag.id);
    expect(row!.values['2025-05']).toBe(50); // 80 expense - 30 refund
    expect(row!.total).toBe(50);
    expect(result.grandTotal).toBe(50);
  });

  it('same-bucket full refund: a fully-refunded category drops out instead of showing a zero row', async () => {
    const account = await helpers.createAccount({ raw: true });
    const category = await helpers.addCustomCategory({
      name: uniqueName('FullyRefunded'),
      color: '#999999',
      raw: true,
    });

    const [expenseTx] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 50,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
        }),
        time: '2025-06-05T12:00:00.000Z',
      },
      raw: true,
    });
    const [refundTx] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 50,
          transactionType: TRANSACTION_TYPES.income,
          categoryId: category.id,
        }),
        time: '2025-06-25T12:00:00.000Z', // same month as the expense
      },
      raw: true,
    });
    await helpers.createSingleRefund({ originalTxId: expenseTx.id, refundTxId: refundTx.id });

    const result = await helpers.getPivotReport({
      from: '2025-06-01',
      to: '2025-06-30',
      granularity: 'monthly',
      rowDimension: 'category',
      measure: 'expense',
      raw: true,
    });

    // The bucket nets to exactly 0, so the column is dropped, the row has no data left, and it
    // disappears from the report rather than rendering a $0 row.
    expect(result.rows.find((candidate) => candidate.id === category.id)).toBeUndefined();
    expect(result.grandTotal).toBe(0);
  });

  it('planned rows never contribute to a cell', async () => {
    const account = await helpers.createAccount({ raw: true });
    const category = await helpers.addCustomCategory({ name: uniqueName('Mixed'), color: '#5566aa', raw: true });
    const plannedOnlyCategory = await helpers.addCustomCategory({
      name: uniqueName('PlannedOnly'),
      color: '#aa5566',
      raw: true,
    });

    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
        }),
        time: '2026-03-10T12:00:00.000Z',
      },
      raw: true,
    });
    await helpers.createPlannedTransaction({
      payload: {
        accountId: account.id,
        amount: 40,
        transactionType: TRANSACTION_TYPES.expense,
        categoryId: category.id,
        time: '2026-03-20T12:00:00.000Z',
      },
      raw: true,
    });
    await helpers.createPlannedTransaction({
      payload: {
        accountId: account.id,
        amount: 25,
        transactionType: TRANSACTION_TYPES.expense,
        categoryId: plannedOnlyCategory.id,
        time: '2026-03-21T12:00:00.000Z',
      },
      raw: true,
    });

    const result = await helpers.getPivotReport({
      from: '2026-03-01',
      to: '2026-03-31',
      granularity: 'monthly',
      rowDimension: 'category',
      measure: 'expense',
      raw: true,
    });

    // The report is money that moved, so the 40 plan is absent from the mixed category and the
    // plan-only category has nothing to report at all.
    const row = result.rows.find((candidate) => candidate.id === category.id);
    expect(row!.values['2026-03']).toBe(100);
    expect(row!.total).toBe(100);
    expect(result.rows.find((candidate) => candidate.id === plannedOnlyCategory.id)).toBeUndefined();
    expect(result.columnTotals['2026-03']).toBe(100);
    expect(result.grandTotal).toBe(100);
  });

  it('income measure: a refund of an expense is not income, so expense minus income nets it once', async () => {
    const account = await helpers.createAccount({ raw: true });
    // Each leg gets its own category/payee/tag, so netting against the wrong leg leaves a row behind.
    const createLeg = async ({
      amount,
      transactionType,
      time,
    }: {
      amount: number;
      transactionType: TRANSACTION_TYPES;
      time: string;
    }) => {
      const category = await helpers.addCustomCategory({ name: uniqueName('Leg'), color: '#445566', raw: true });
      const payee = await helpers.createPayee({ payload: { name: uniqueName('Leg') }, raw: true });
      const tag = await helpers.createTag({ payload: { name: uniqueName('Leg'), color: '#abcdef' }, raw: true });
      const [tx] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: account.id,
            amount,
            transactionType,
            categoryId: category.id,
            payeeId: payee.id,
          }),
          time,
        },
        raw: true,
      });
      await helpers.addTransactionsToTag({ tagId: tag.id, transactionIds: [tx.id] });
      return tx;
    };

    const expenseTx = await createLeg({
      amount: 10,
      transactionType: TRANSACTION_TYPES.expense,
      time: '2025-05-10T12:00:00.000Z',
    });
    const refundTx = await createLeg({
      amount: 1,
      transactionType: TRANSACTION_TYPES.income,
      time: '2025-05-20T12:00:00.000Z',
    });
    await helpers.createSingleRefund({ originalTxId: expenseTx.id, refundTxId: refundTx.id });

    for (const rowDimension of ['category', 'payee', 'tag'] as const) {
      const params = { from: '2025-05-01', to: '2025-05-31', granularity: 'monthly', rowDimension, raw: true } as const;
      const expense = await helpers.getPivotReport({ ...params, measure: 'expense' });
      const income = await helpers.getPivotReport({ ...params, measure: 'income' });

      expect(expense.grandTotal).toBe(9);
      expect(income.grandTotal).toBe(0);
      expect(income.rows).toEqual([]);
    }
  });

  it('income measure: planned income never contributes to a cell', async () => {
    const account = await helpers.createAccount({ raw: true });
    const category = await helpers.addCustomCategory({ name: uniqueName('Freelance'), color: '#33bb77', raw: true });

    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 200,
          transactionType: TRANSACTION_TYPES.income,
          categoryId: category.id,
        }),
        time: '2026-04-10T12:00:00.000Z',
      },
      raw: true,
    });
    await helpers.createPlannedTransaction({
      payload: {
        accountId: account.id,
        amount: 70,
        transactionType: TRANSACTION_TYPES.income,
        categoryId: category.id,
        time: '2026-04-20T12:00:00.000Z',
      },
      raw: true,
    });

    const result = await helpers.getPivotReport({
      from: '2026-04-01',
      to: '2026-04-30',
      granularity: 'monthly',
      rowDimension: 'category',
      measure: 'income',
      raw: true,
    });

    const row = result.rows.find((candidate) => candidate.id === category.id);
    expect(row!.values['2026-04']).toBe(200);
    expect(row!.total).toBe(200);
    expect(result.columnTotals['2026-04']).toBe(200);
    expect(result.grandTotal).toBe(200);
  });
});
