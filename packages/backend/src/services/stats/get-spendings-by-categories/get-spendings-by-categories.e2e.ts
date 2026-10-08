import {
  CategoryModel,
  type GetSpendingsByCategoriesReturnType,
  RESOURCE_TYPES,
  type RecordId,
  SHARE_PERMISSIONS,
  TRANSACTIONS_WRITE_SCOPES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { expectCompleted, waitForBudgetBakersWalletCompletion } from '@tests/helpers/import-export';

const uniqueName = (prefix: string): string => `${prefix}-${generateRandomRecordId()}`;

describe('[Stats] Spendings by categories – categoryIds filter', () => {
  it('Returns spending grouped by selected categories instead of root', async () => {
    const account = await helpers.createAccount({ raw: true });
    const categoriesList = await helpers.getCategoriesList();

    // Pick a root category and one of its children
    const rootCategory = categoriesList.find((c) => !c.parentId)!;
    const childCategory = categoriesList.find((c) => c.parentId === rootCategory.id)!;

    // Create a nested sub-sub category under the child
    const subChild = await helpers.addCustomCategory({
      parentId: childCategory.id,
      name: 'sub-child-test',
      raw: true,
    });

    // Create transactions: 100 on root, 200 on child, 300 on sub-child
    await Promise.all([
      helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 100, categoryId: rootCategory.id }),
        raw: true,
      }),
      helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 200, categoryId: childCategory.id }),
        raw: true,
      }),
      helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 300, categoryId: subChild.id }),
        raw: true,
      }),
    ]);

    // Without categoryIds: everything grouped under root
    const rootGrouped = await helpers.getSpendingsByCategories({ raw: true });
    expect(rootGrouped[rootCategory.id.toString()].amount).toBe(600); // 100 + 200 + 300

    // With categoryIds selecting only the child: child gets its own (200) + sub-child (300) = 500
    const childGrouped = await helpers.getSpendingsByCategories({
      raw: true,
      categoryIds: [childCategory.id],
    });
    expect(childGrouped[childCategory.id.toString()]).toEqual({
      name: childCategory.name,
      color: childCategory.color,
      amount: 500,
    });
    // Root category should NOT appear (transaction tagged directly on root doesn't belong to childCategory)
    expect(childGrouped[rootCategory.id.toString()]).toBeUndefined();

    // Each transaction rolls up to its nearest selected ancestor: child and sub-child
    // land on child (500), root keeps only its own 100.
    const bothSelected = await helpers.getSpendingsByCategories({
      raw: true,
      categoryIds: [rootCategory.id, childCategory.id],
    });

    expect(bothSelected[rootCategory.id.toString()].amount).toBe(100);
    expect(bothSelected[childCategory.id.toString()].amount).toBe(500);
  }, 60_000);

  it('Pre-initializes selected categories with zero in both response shapes', async () => {
    await helpers.createAccount({ raw: true });
    const categoriesList = await helpers.getCategoriesList();
    const rootCategory = categoriesList.find((c) => !c.parentId)!;

    // Request spending for a category with no transactions
    const result = await helpers.getSpendingsByCategories({
      raw: true,
      categoryIds: [rootCategory.id],
    });

    expect(result[rootCategory.id.toString()]).toEqual({
      name: rootCategory.name,
      color: rootCategory.color,
      amount: 0,
    });

    const groupedByType = await helpers.getSpendingsByCategories({
      raw: true,
      groupByType: true,
      categoryIds: [rootCategory.id],
    });

    expect(groupedByType[rootCategory.id.toString()]).toEqual({
      name: rootCategory.name,
      color: rootCategory.color,
      income: 0,
      expense: 0,
    });
  });
});

describe('[Stats] Spendings by categories – groupByType', () => {
  it('returns per-category income and expense buckets in a single response', async () => {
    const account = await helpers.createAccount({ raw: true });
    const accountB = await helpers.createAccount({ raw: true });
    const categoriesList = await helpers.getCategoriesList();
    const category = categoriesList.find((c) => !c.parentId)!;

    await Promise.all([
      helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 200,
          categoryId: category.id,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      }),
      helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 300,
          categoryId: category.id,
          transactionType: TRANSACTION_TYPES.income,
        }),
        raw: true,
      }),
    ]);

    // Transfers must be ignored by stats, even in the per-type breakdown.
    const transferResponse = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({ accountId: account.id, amount: 500, categoryId: category.id }),
        transactionType: TRANSACTION_TYPES.expense,
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationAmount: 500,
        destinationAccountId: accountB.id,
      },
    });
    expect(transferResponse.statusCode).toBe(200);

    const result = await helpers.getSpendingsByCategories({
      raw: true,
      groupByType: true,
      categoryIds: [category.id],
    });

    expect(result[category.id.toString()]).toEqual({
      name: category.name,
      color: category.color,
      income: 300,
      expense: 200,
    });
  });

  it('nets a refund on both sides instead of reporting it as income', async () => {
    const account = await helpers.createAccount({ raw: true });
    const refundedCategory = await helpers.addCustomCategory({
      name: uniqueName('RefundedByType'),
      color: '#123123',
      raw: true,
    });
    const refundCategory = await helpers.addCustomCategory({
      name: uniqueName('RefundLandingByType'),
      color: '#321321',
      raw: true,
    });

    const [expenseTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 200,
        transactionType: TRANSACTION_TYPES.expense,
        categoryId: refundedCategory.id,
      }),
      raw: true,
    });
    const [refundTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 50,
        transactionType: TRANSACTION_TYPES.income,
        categoryId: refundCategory.id,
      }),
      raw: true,
    });
    await helpers.createSingleRefund({ originalTxId: expenseTx.id, refundTxId: refundTx.id });

    const result = await helpers.getSpendingsByCategories({
      raw: true,
      groupByType: true,
      categoryIds: [refundedCategory.id, refundCategory.id],
    });

    // The refund reduces the refunded expense; the income row that carried the money back is not
    // an income source, so its own category reports 0 income.
    expect(result[refundedCategory.id.toString()]).toMatchObject({ income: 0, expense: 150 });
    expect(result[refundCategory.id.toString()]).toMatchObject({ income: 0, expense: 0 });
  });

  it('rejects an inverted date range and a malformed / non-real date', async () => {
    const inverted = await helpers.getSpendingsByCategories({
      from: '2026-07-31',
      to: '2026-07-01',
      groupByType: true,
    });

    expect(inverted.statusCode).toEqual(ERROR_CODES.ValidationError);

    const malformed = await helpers.getSpendingsByCategories({
      // Month 13 / day 45 is not a real calendar date.
      from: '2026-13-45',
      to: '2026-07-31',
      groupByType: true,
    });

    expect(malformed.statusCode).toEqual(ERROR_CODES.ValidationError);
  });
});

describe('[Stats] Spendings by categories', () => {
  it('Returns correct list of data for simple transactions list', async () => {
    const account = await helpers.createAccount({ raw: true });
    const payload = helpers.buildTransactionPayload({
      accountId: account.id,
      amount: 100,
    });
    const categoriesList = await helpers.getCategoriesList();
    const category = categoriesList.find((i) => i.id === payload.categoryId)!;

    await Promise.all([
      helpers.createTransaction({
        payload,
        raw: true,
      }),
      helpers.createTransaction({
        payload,
        raw: true,
      }),
    ]);

    const data = await helpers.getSpendingsByCategories({ raw: true });

    expect(data).toEqual({
      [category.id]: {
        name: category.name,
        color: category.color,
        amount: 200,
      },
    });
  });
  it(`Returns correct list of data for transactions that have:
      - transfer transactions
      - refunds
      - income transactions
      - different accounts
      - different currencies
  `, async () => {
    const CATEGORIES_AMOUNT_FOR_EACH_NESTING_LEVEL = 2;
    const account = await helpers.createAccount({ raw: true });
    const accountB = await helpers.createAccount({ raw: true });
    const categoriesList = await helpers.getCategoriesList();

    // Prepare root-level categoris
    const rootCategories = categoriesList.filter((c) => !c.parentId).slice(0, CATEGORIES_AMOUNT_FOR_EACH_NESTING_LEVEL);

    // Prepare nested 1-level categories
    const excludedIds = new Set<string>([]);
    const firstLevelNestedCategories = categoriesList.filter((c) => {
      if (c.parentId) {
        if (rootCategories.some((e) => e.id === c.parentId) && !excludedIds.has(c.parentId)) {
          excludedIds.add(c.parentId);
          return true;
        }
      }
      return false;
    });

    // Prepare nested 2-level categories
    const [customCategory1, customCategory2] = await Promise.all(
      firstLevelNestedCategories.map((i) =>
        helpers.addCustomCategory({
          parentId: i.id,
          name: `test-${i.id}`,
          raw: true,
        }),
      ),
    );

    const fullCategoriesList = [
      ...rootCategories,
      ...firstLevelNestedCategories,
      customCategory1,
      customCategory2,
    ].filter(Boolean) as CategoryModel[];

    const payload = helpers.buildTransactionPayload({
      accountId: account.id,
      amount: 200,
    });

    const expenseTransactions = await Promise.all(
      fullCategoriesList.map((c) =>
        helpers.createTransaction({
          payload: {
            ...payload,
            categoryId: c.id,
          },
          raw: true,
        }),
      ),
    );

    // Create transfer transactions just for their existance. They should be ignored by stats
    const transferTxResponse = await helpers.createTransaction({
      payload: {
        ...payload,
        transactionType: TRANSACTION_TYPES.expense,
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationAmount: 100,
        destinationAccountId: accountB.id,
      },
    });
    expect(transferTxResponse.statusCode).toBe(200);
    // Create income transactions just for their existance and for refunds
    const [[incomeThatWillBeRefunded], [incomeThatRefunds]] = await Promise.all([
      helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          transactionType: TRANSACTION_TYPES.income,
          amount: 300,
        }),
        raw: true,
      }),
      helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          transactionType: TRANSACTION_TYPES.income,
          amount: 100,
        }),
        raw: true,
      }),
    ]);

    // Create two refunds based on income tx:
    // – in first income is being REFUNDED
    // – in second income is REFUNDING the existing expense
    const tx1 = expenseTransactions.flat().find((t) => t!.categoryId === customCategory1!.id);
    const tx2 = expenseTransactions.flat().find((t) => t!.categoryId === customCategory2!.id);
    await Promise.all([
      helpers.createSingleRefund(
        {
          originalTxId: incomeThatWillBeRefunded.id,
          refundTxId: tx1!.id,
        },
        true,
      ),
      helpers.createSingleRefund(
        {
          originalTxId: tx2!.id,
          refundTxId: incomeThatRefunds.id,
        },
        true,
      ),
    ]);

    let spendingsByCategories = await helpers.getSpendingsByCategories({
      raw: true,
    });

    // There is 6 transactions, each of 200. 3 tx per each category. So 200 * 3 = 600
    // 1 transaction refunds income with value 300, so it should fully be "ignored". So 600 - 200 = 400
    // 1 transaction is being refunded by income with value 100, so 600 - (200 - 100) = 500
    // Transfers are ignored
    expect(spendingsByCategories).toEqual({
      [rootCategories[0]!.id]: {
        name: rootCategories[0]!.name,
        color: rootCategories[0]!.color,
        amount: 400,
      },
      [rootCategories[1]!.id]: {
        name: rootCategories[1]!.name,
        color: rootCategories[1]!.color,
        amount: 500,
      },
    });

    /**
     * Part 2: Test with different currencies
     * 1. Create two custom currencies UAH and EUR with custom rates
     * 2. Create new accounts with custom currencies, and add transactions to
     * them
     * 3. Make a multi-currency refund
     * 4. Check that after that stats are correct
     */

    const newCurrencies: string[] = [global.BASE_CURRENCY_CODE, 'UAH', 'EUR'];
    await helpers.addUserCurrencies({
      currencyCodes: newCurrencies,
      raw: true,
    });
    const userCurrencies = await helpers.getUserCurrencies();
    const [usdCurrency, uahCurrency, eurCurrency] = newCurrencies.map((c) =>
      userCurrencies.find((i) => i.currency.code === c),
    );

    // Set fake custom exchange rates so it's easier to calculate them in tests
    await helpers.editUserCurrencyExchangeRate({
      pairs: [
        {
          baseCode: usdCurrency!.currency.code,
          quoteCode: uahCurrency!.currency.code,
          rate: 10,
        },
        {
          baseCode: uahCurrency!.currency.code,
          quoteCode: usdCurrency!.currency.code,
          rate: 0.1,
        },
        {
          baseCode: usdCurrency!.currency.code,
          quoteCode: eurCurrency!.currency.code,
          rate: 2,
        },
        {
          baseCode: eurCurrency!.currency.code,
          quoteCode: usdCurrency!.currency.code,
          rate: 0.5,
        },
      ],
    });
    const uahAccount = await helpers.createAccount({
      payload: {
        ...helpers.buildAccountPayload(),
        currencyCode: uahCurrency!.currencyCode,
      },
      raw: true,
    });
    const eurAccount = await helpers.createAccount({
      payload: {
        ...helpers.buildAccountPayload(),
        currencyCode: eurCurrency!.currencyCode,
      },
      raw: true,
    });

    const [eurExpenseTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: eurAccount.id,
        transactionType: TRANSACTION_TYPES.expense,
        amount: 1000,
      }),
      raw: true,
    });
    // Just one more expense with different currency
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: uahAccount.id,
        transactionType: TRANSACTION_TYPES.expense,
        amount: 10000,
      }),
      raw: true,
    });
    const [uahIncomeTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: uahAccount.id,
        transactionType: TRANSACTION_TYPES.income,
        amount: 1000,
      }),
      raw: true,
    });

    spendingsByCategories = await helpers.getSpendingsByCategories({
      raw: true,
    });

    const creationResponse = await helpers.createSingleRefund({
      originalTxId: eurExpenseTx.id,
      refundTxId: uahIncomeTx.id,
    });
    expect(creationResponse.statusCode).toBe(200);
    spendingsByCategories = await helpers.getSpendingsByCategories({
      raw: true,
    });

    expect(spendingsByCategories).toEqual({
      [rootCategories[0]!.id]: {
        name: rootCategories[0]!.name,
        color: rootCategories[0]!.color,
        // 400 (initial) + 400 (expense eur 500 - uah income refund 100) + 1000 (uah expense)
        amount: 400 + 400 + 1000,
      },
      [rootCategories[1]!.id]: {
        name: rootCategories[1]!.name,
        color: rootCategories[1]!.color,
        amount: 500,
      },
    });
  });
});

/**
 * Regression: a recipient on a shared account creates a transaction tagged with the owner's
 * categoryId (forced by S4). Before the categories lookup was widened to include accessible
 * owners, those rows fell out of the recipient's category map and the dashboard widget
 * rendered them as "Unknown" with a black wedge.
 */
describe('[Stats] Spendings by categories — shared accounts', () => {
  it('resolves owner category name + color when recipient logs a tx on a shared account', async () => {
    const ownerAccount = await helpers.createAccount({ raw: true });
    const ownerCategory = await helpers.addCustomCategory({
      name: 'Owner Groceries',
      color: '#A1B2C3',
      raw: true,
    });

    const recipient = await helpers.signUpSecondUser();
    await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.setBaseCurrencyForActiveUser({ currencyCode: global.BASE_CURRENCY.code }),
    });

    const invitation = await helpers.createShareInvitation({
      inviteeEmail: recipient.email,
      resourceType: RESOURCE_TYPES.account,
      resourceId: ownerAccount.id,
      permission: SHARE_PERMISSIONS.write,
      policy: { transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all },
      raw: true,
    });

    await helpers.asUser({
      cookies: recipient.cookies,
      fn: async () => {
        await helpers.acceptShareInvitation({ token: invitation.token, raw: true });
        await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: ownerAccount.id,
            amount: 1500,
            transactionType: TRANSACTION_TYPES.expense,
            categoryId: ownerCategory.id,
          }),
          raw: true,
        });

        const result = await helpers.getSpendingsByCategories({ raw: true });
        const bucket = result[ownerCategory.id.toString()];
        expect(bucket).toBeDefined();
        expect(bucket).toEqual({
          amount: 1500,
          name: ownerCategory.name,
          color: ownerCategory.color,
        });
      },
    });
  });
});

/**
 * The exclusion list is a snapshot saved in the dashboard widget config, and it has to produce the
 * same numbers here as it does in the cash-flow widget: descendants of a hidden category count as
 * hidden, and hiding a category never takes an unrelated split down with it.
 */
describe('[Stats] Spendings by categories – excludedCategoryIds', () => {
  it('drops the excluded category and leaves the rest of the breakdown alone', async () => {
    const account = await helpers.createAccount({ raw: true });
    const keptCategory = await helpers.addCustomCategory({ name: uniqueName('Kept'), color: '#112233', raw: true });
    const hiddenCategory = await helpers.addCustomCategory({ name: uniqueName('Hidden'), color: '#332211', raw: true });

    for (const [category, amount] of [
      [keptCategory, 40],
      [hiddenCategory, 60],
    ] as const) {
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
        }),
        raw: true,
      });
    }

    const result = await helpers.getSpendingsByCategories({
      excludedCategoryIds: [hiddenCategory.id],
      raw: true,
    });

    expect(result[keptCategory.id.toString()].amount).toBe(40);
    expect(result[hiddenCategory.id.toString()]).toBeUndefined();
  });

  it('keeps a split into a visible category when the transaction category itself is excluded', async () => {
    const account = await helpers.createAccount({ raw: true });
    const hiddenCategory = await helpers.addCustomCategory({
      name: uniqueName('HiddenPrimary'),
      color: '#aa1100',
      raw: true,
    });
    const splitCategory = await helpers.addCustomCategory({
      name: uniqueName('SplitKept'),
      color: '#0011aa',
      raw: true,
    });

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
        categoryId: hiddenCategory.id,
        splits: [{ categoryId: splitCategory.id, amount: 30 }],
      }),
      raw: true,
    });

    const result = await helpers.getSpendingsByCategories({
      excludedCategoryIds: [hiddenCategory.id],
      raw: true,
    });

    // The 70 residual belongs to the hidden category; only the 30 the user still wants to see stays.
    expect(result[splitCategory.id.toString()].amount).toBe(30);
    expect(result[hiddenCategory.id.toString()]).toBeUndefined();
  });

  it('removes only the excluded split, leaving the rest of its transaction counted', async () => {
    const account = await helpers.createAccount({ raw: true });
    const primaryCategory = await helpers.addCustomCategory({
      name: uniqueName('PrimaryKept'),
      color: '#123456',
      raw: true,
    });
    const splitCategory = await helpers.addCustomCategory({
      name: uniqueName('SplitHidden'),
      color: '#654321',
      raw: true,
    });

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
        categoryId: primaryCategory.id,
        splits: [{ categoryId: splitCategory.id, amount: 30 }],
      }),
      raw: true,
    });

    const result = await helpers.getSpendingsByCategories({
      excludedCategoryIds: [splitCategory.id],
      raw: true,
    });

    expect(result[primaryCategory.id.toString()].amount).toBe(70);
    expect(result[splitCategory.id.toString()]).toBeUndefined();
  });

  it('hides a subcategory of an excluded parent that the list itself does not name', async () => {
    const account = await helpers.createAccount({ raw: true });
    const parentCategory = await helpers.addCustomCategory({
      name: uniqueName('HiddenParent'),
      color: '#221100',
      raw: true,
    });
    const childCategory = await helpers.addCustomCategory({
      name: uniqueName('HiddenChild'),
      color: '#001122',
      parentId: parentCategory.id,
      raw: true,
    });
    const keptCategory = await helpers.addCustomCategory({ name: uniqueName('Kept'), color: '#123123', raw: true });

    for (const [category, amount] of [
      [childCategory, 200],
      [keptCategory, 50],
    ] as const) {
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
        }),
        raw: true,
      });
    }

    // Only the parent is named — the caller saved the exclusion list before the subcategory
    // existed, so the server has to fill in the descendants itself.
    const result = await helpers.getSpendingsByCategories({
      excludedCategoryIds: [parentCategory.id],
      raw: true,
    });

    // The report rolls to roots, so a leaked child would resurface under the hidden parent.
    expect(result[parentCategory.id.toString()]).toBeUndefined();
    expect(result[childCategory.id.toString()]).toBeUndefined();
    expect(result[keptCategory.id.toString()].amount).toBe(50);
  });

  it('keeps the parent counted when only one of its subcategories is excluded', async () => {
    const account = await helpers.createAccount({ raw: true });
    const parentCategory = await helpers.addCustomCategory({
      name: uniqueName('KeptParent'),
      color: '#334455',
      raw: true,
    });
    const childCategory = await helpers.addCustomCategory({
      name: uniqueName('HiddenChild'),
      color: '#554433',
      parentId: parentCategory.id,
      raw: true,
    });

    for (const [category, amount] of [
      [parentCategory, 40],
      [childCategory, 60],
    ] as const) {
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
        }),
        raw: true,
      });
    }

    const result = await helpers.getSpendingsByCategories({
      excludedCategoryIds: [childCategory.id],
      raw: true,
    });

    expect(result[parentCategory.id.toString()].amount).toBe(40);
  });

  it('leaves the report untouched when the excluded id matches nothing', async () => {
    const account = await helpers.createAccount({ raw: true });
    const category = await helpers.addCustomCategory({ name: uniqueName('Unrelated'), color: '#010203', raw: true });

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 25,
        transactionType: TRANSACTION_TYPES.expense,
        categoryId: category.id,
      }),
      raw: true,
    });

    const result = await helpers.getSpendingsByCategories({
      excludedCategoryIds: [generateRandomRecordId()],
      raw: true,
    });

    expect(result[category.id.toString()].amount).toBe(25);
  });

  it('drops the refund adjustment together with the spend it nets', async () => {
    const account = await helpers.createAccount({ raw: true });
    const hiddenCategory = await helpers.addCustomCategory({
      name: uniqueName('HiddenRefunded'),
      color: '#654321',
      raw: true,
    });
    const keptCategory = await helpers.addCustomCategory({ name: uniqueName('Kept'), color: '#111111', raw: true });

    const [expenseTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
        categoryId: hiddenCategory.id,
      }),
      raw: true,
    });
    const [refundTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 30,
        transactionType: TRANSACTION_TYPES.income,
        categoryId: hiddenCategory.id,
      }),
      raw: true,
    });
    await helpers.createSingleRefund({ originalTxId: expenseTx.id, refundTxId: refundTx.id });

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 45,
        transactionType: TRANSACTION_TYPES.expense,
        categoryId: keptCategory.id,
      }),
      raw: true,
    });

    const result = await helpers.getSpendingsByCategories({
      excludedCategoryIds: [hiddenCategory.id],
      raw: true,
    });

    // Both the gross spend and the negative leg that nets it belong to the hidden category, so
    // neither may leak — a surviving refund leg alone would show up as negative spend.
    expect(result[hiddenCategory.id.toString()]).toBeUndefined();
    expect(result[keptCategory.id.toString()].amount).toBe(45);
  });

  it('keeps the period total in step with the visible breakdown', async () => {
    const account = await helpers.createAccount({ raw: true });
    const hiddenCategory = await helpers.addCustomCategory({
      name: uniqueName('HiddenTotal'),
      color: '#0f0f0f',
      raw: true,
    });
    const splitCategory = await helpers.addCustomCategory({
      name: uniqueName('SplitKeptTotal'),
      color: '#f0f0f0',
      raw: true,
    });

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
        categoryId: hiddenCategory.id,
        splits: [{ categoryId: splitCategory.id, amount: 30 }],
      }),
      raw: true,
    });

    const breakdown = await helpers.getSpendingsByCategories({
      excludedCategoryIds: [hiddenCategory.id],
      raw: true,
    });
    const total = await helpers.getExpensesAmountForPeriod({
      excludedCategoryIds: [hiddenCategory.id],
      raw: true,
    });

    const breakdownSum = Object.values(breakdown as GetSpendingsByCategoriesReturnType).reduce<number>(
      (sum, bucket) => sum + bucket.amount,
      0,
    );
    expect(total).toBe(30);
    expect(total).toBe(breakdownSum);
  });

  it('applies exclusions to both directions of the groupByType response', async () => {
    const account = await helpers.createAccount({ raw: true });
    const parentCategory = await helpers.addCustomCategory({
      name: uniqueName('HiddenParentByType'),
      color: '#abcdef',
      raw: true,
    });
    const childCategory = await helpers.addCustomCategory({
      name: uniqueName('HiddenChildByType'),
      color: '#fedcba',
      parentId: parentCategory.id,
      raw: true,
    });
    const keptCategory = await helpers.addCustomCategory({
      name: uniqueName('KeptByType'),
      color: '#999999',
      raw: true,
    });

    for (const [category, amount, transactionType] of [
      [childCategory, 200, TRANSACTION_TYPES.expense],
      [childCategory, 300, TRANSACTION_TYPES.income],
      [keptCategory, 50, TRANSACTION_TYPES.expense],
    ] as const) {
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount,
          transactionType,
          categoryId: category.id,
        }),
        raw: true,
      });
    }

    const result = await helpers.getSpendingsByCategories({
      groupByType: true,
      excludedCategoryIds: [parentCategory.id],
      raw: true,
    });

    expect(result[parentCategory.id.toString()]).toBeUndefined();
    expect(result[childCategory.id.toString()]).toBeUndefined();
    expect(result[keptCategory.id.toString()]).toEqual({
      name: keptCategory.name,
      color: keptCategory.color,
      income: 0,
      expense: 50,
    });
  });

  it('drops a malformed id from the list and still applies the valid ones', async () => {
    const account = await helpers.createAccount({ raw: true });
    const hiddenCategory = await helpers.addCustomCategory({
      name: uniqueName('HiddenAmongGarbage'),
      color: '#987654',
      raw: true,
    });

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 80,
        transactionType: TRANSACTION_TYPES.expense,
        categoryId: hiddenCategory.id,
      }),
      raw: true,
    });

    // `optionalCommaSeparatedIds` filters unparseable entries out rather than rejecting the
    // request, so one bad id must not take the rest of the exclusion list down with it.
    const response = await helpers.makeRequest<GetSpendingsByCategoriesReturnType, true>({
      method: 'get',
      url: `/stats/spendings-by-categories?excludedCategoryIds=not-a-uuid,${hiddenCategory.id}`,
      raw: true,
    });

    expect(response[hiddenCategory.id.toString()]).toBeUndefined();
  });

  /**
   * A transaction can carry no category at all (a Wallet import row whose category was left
   * unmapped), and its splits still belong in the report. `NOT IN (…)` in SQL evaluates to NULL
   * for such a row, which drops it — taking the split with it.
   *
   * The import is the only endpoint that produces an uncategorized transaction: POST
   * /transactions rejects a non-transfer without a categoryId.
   */
  it('keeps the splits of an uncategorized transaction when another category is excluded', async () => {
    const splitCategory = await helpers.addCustomCategory({
      name: uniqueName('SplitOnUncategorized'),
      color: '#5566aa',
      raw: true,
    });
    const hiddenCategory = await helpers.addCustomCategory({
      name: uniqueName('HiddenElsewhere'),
      color: '#aa6655',
      raw: true,
    });

    const accountName = uniqueName('WalletAcc');
    const fileContent = [
      'account;category;currency;amount;ref_currency_amount;type;payment_type;note;date;transfer;payee;labels',
      // "Food" is deliberately absent from categoryMapping, so the row imports with no category.
      `${accountName};Food;${global.BASE_CURRENCY_CODE};200;200;Expense;Credit card;uncategorized-row;2025-01-15T10:00:00.000Z;false;;`,
    ].join('\n');

    const { jobId } = await helpers.executeBudgetBakersWallet({
      payload: {
        fileContent,
        accountMapping: {
          [accountName]: { action: 'create-new', currencyCode: global.BASE_CURRENCY_CODE, currentBalance: null },
        },
        categoryMapping: {},
        skipDuplicateIndices: [],
      },
      raw: true,
    });
    const progress = await waitForBudgetBakersWalletCompletion({ jobId });
    expectCompleted(progress);
    expect(progress.summary.errors).toEqual([]);

    const transactions = await helpers.getTransactions({ raw: true });
    const uncategorizedTx = transactions.find((tx) => tx.note === 'uncategorized-row');
    expect(uncategorizedTx).toBeDefined();
    expect(uncategorizedTx!.categoryId).toBeNull();

    await helpers.updateTransaction({
      id: uncategorizedTx!.id,
      payload: { splits: [{ categoryId: splitCategory.id, amount: 40 }] },
      raw: true,
    });

    const result = await helpers.getSpendingsByCategories({
      excludedCategoryIds: [hiddenCategory.id],
      raw: true,
    });

    expect(result[splitCategory.id.toString()].amount).toBe(40);
  });
});

const expense = async ({
  accountId,
  amount,
  categoryId,
  payeeId,
}: {
  accountId: RecordId;
  amount: number;
  categoryId: RecordId;
  payeeId?: RecordId;
}) => {
  const [tx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId,
      amount,
      categoryId,
      transactionType: TRANSACTION_TYPES.expense,
      ...(payeeId ? { payeeId } : {}),
    }),
    raw: true,
  });
  return tx;
};

describe('[Stats] Spendings by categories – page-level scope filters', () => {
  it('accountIds narrows to the selected accounts', async () => {
    const accountA = await helpers.createAccount({ raw: true });
    const accountB = await helpers.createAccount({ raw: true });
    const category = await helpers.addCustomCategory({ name: uniqueName('Scoped'), color: '#112233', raw: true });

    await expense({ accountId: accountA.id, amount: 70, categoryId: category.id });
    await expense({ accountId: accountB.id, amount: 30, categoryId: category.id });

    const result = await helpers.getSpendingsByCategories({
      accountIds: [accountA.id],
      raw: true,
    });
    expect(result[category.id].amount).toBe(70);
  });

  it('payeeIds keeps only transactions linked to the selected payees', async () => {
    const account = await helpers.createAccount({ raw: true });
    const category = await helpers.addCustomCategory({ name: uniqueName('Scoped'), color: '#112233', raw: true });
    const payeeA = await helpers.createPayee({ payload: { name: uniqueName('Acme') }, raw: true });
    const payeeB = await helpers.createPayee({ payload: { name: uniqueName('Globex') }, raw: true });

    await expense({ accountId: account.id, amount: 40, categoryId: category.id, payeeId: payeeA.id });
    await expense({ accountId: account.id, amount: 25, categoryId: category.id, payeeId: payeeB.id });

    const result = await helpers.getSpendingsByCategories({
      payeeIds: [payeeA.id],
      raw: true,
    });
    expect(result[category.id].amount).toBe(40);
  });

  it('tagIds counts a transaction carrying two selected tags exactly once', async () => {
    const account = await helpers.createAccount({ raw: true });
    const category = await helpers.addCustomCategory({ name: uniqueName('Scoped'), color: '#112233', raw: true });
    const tagA = await helpers.createTag({ payload: { name: uniqueName('TagA'), color: '#ff0000' }, raw: true });
    const tagB = await helpers.createTag({ payload: { name: uniqueName('TagB'), color: '#00ff00' }, raw: true });

    const doubleTagged = await expense({ accountId: account.id, amount: 50, categoryId: category.id });
    await helpers.addTransactionsToTag({
      tagId: tagA.id,
      transactionIds: [doubleTagged.id],
    });
    await helpers.addTransactionsToTag({
      tagId: tagB.id,
      transactionIds: [doubleTagged.id],
    });

    await expense({ accountId: account.id, amount: 20, categoryId: category.id });

    const result = await helpers.getSpendingsByCategories({
      tagIds: [tagA.id, tagB.id],
      raw: true,
    });
    expect(result[category.id].amount).toBe(50);
  });

  it('excludedPayeeIds drops the excluded payee while a payee-less transaction stays', async () => {
    const account = await helpers.createAccount({ raw: true });
    const category = await helpers.addCustomCategory({ name: uniqueName('Scoped'), color: '#112233', raw: true });
    const payee = await helpers.createPayee({ payload: { name: uniqueName('Acme') }, raw: true });

    await expense({ accountId: account.id, amount: 40, categoryId: category.id, payeeId: payee.id });
    await expense({ accountId: account.id, amount: 15, categoryId: category.id });

    const result = await helpers.getSpendingsByCategories({ excludedPayeeIds: [payee.id], raw: true });
    expect(result[category.id].amount).toBe(15);
  });

  it('excludedTagIds drops a transaction carrying an excluded tag and keeps an untagged one', async () => {
    const account = await helpers.createAccount({ raw: true });
    const category = await helpers.addCustomCategory({ name: uniqueName('Scoped'), color: '#112233', raw: true });
    const excludedTag = await helpers.createTag({
      payload: { name: uniqueName('Hidden'), color: '#ff0000' },
      raw: true,
    });
    const otherTag = await helpers.createTag({ payload: { name: uniqueName('Other'), color: '#00ff00' }, raw: true });

    const tagged = await expense({ accountId: account.id, amount: 70, categoryId: category.id });
    await helpers.addTransactionsToTag({ tagId: excludedTag.id, transactionIds: [tagged.id] });
    await helpers.addTransactionsToTag({ tagId: otherTag.id, transactionIds: [tagged.id] });

    await expense({ accountId: account.id, amount: 25, categoryId: category.id });

    const result = await helpers.getSpendingsByCategories({ excludedTagIds: [excludedTag.id], raw: true });
    expect(result[category.id].amount).toBe(25);
  });

  it('empty state: a tag with no transactions yields no categories', async () => {
    const account = await helpers.createAccount({ raw: true });
    const category = await helpers.addCustomCategory({ name: uniqueName('Scoped'), color: '#112233', raw: true });
    const unusedTag = await helpers.createTag({ payload: { name: uniqueName('Unused'), color: '#123456' }, raw: true });

    await expense({ accountId: account.id, amount: 60, categoryId: category.id });

    const result = await helpers.getSpendingsByCategories({
      tagIds: [unusedTag.id],
      raw: true,
    });
    expect(result).toEqual({});
  });
});
