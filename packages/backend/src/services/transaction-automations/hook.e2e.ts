import type {
  AccountMappingConfig,
  AutomationAction,
  AutomationConditions,
  CategoryMappingConfig,
  ColumnMappingConfig,
  TagMappingConfig,
} from '@bt/shared/types';
import {
  AccountOptionValue,
  CATEGORIZATION_MODE,
  CATEGORIZATION_SOURCE,
  CategoryOptionValue,
  CurrencyOptionValue,
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_TYPES,
  TRANSACTION_TYPES,
  TagOptionValue,
  TransactionTypeOptionValue,
  asDecimal,
} from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { LunchFlowApiTransaction } from '@services/bank-data-providers/lunchflow/types';
import * as helpers from '@tests/helpers';
import {
  expectCsvImportCompleted,
  expectYnabImportCompleted,
  waitForCsvImportCompletion,
  waitForYnabImportCompletion,
} from '@tests/helpers/import-export';
import { getLunchFlowBalanceMock, getLunchFlowTransactionsMock } from '@tests/mocks/lunchflow/mock-api';
import { subDays } from 'date-fns';

// The `createTransaction` automations hook, driven through mocked LunchFlow/Monobank
// syncs, the CSV import endpoints and POST /transactions.

const noteRule = ({ name, keyword, actions }: { name: string; keyword: string; actions: AutomationAction[] }) =>
  helpers.createAutomation({
    payload: {
      name,
      conditions: { match: 'all', items: [{ field: 'note', operator: 'contains_any', value: [keyword] }] },
      actions,
    },
    raw: true,
  });

const buildLunchFlowTx = (overrides: Partial<LunchFlowApiTransaction> = {}): LunchFlowApiTransaction => ({
  id: generateRandomRecordId(),
  accountId: 1001,
  amount: asDecimal(-25),
  currency: 'USD',
  date: new Date().toISOString(),
  merchant: 'Generic Merchant',
  description: 'Generic description',
  isPending: false,
  ...overrides,
});

/** Pair LunchFlow, pin the feed and connect the first external account — connecting syncs. */
const syncLunchFlow = async ({ transactions }: { transactions: LunchFlowApiTransaction[] }) => {
  const { connectionId } = await helpers.lunchflow.pair();

  global.mswMockServer.use(
    getLunchFlowTransactionsMock({ response: { transactions, total: transactions.length } }),
    getLunchFlowBalanceMock(),
  );

  const { accounts } = await helpers.bankDataProviders.listExternalAccounts({ connectionId, raw: true });
  const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
    connectionId,
    accountExternalIds: [accounts[0]!.externalId],
    raw: true,
  });

  return { connectionId, account: syncedAccounts[0]! };
};

const txByNote = async (note: string) => {
  const list = await helpers.getTransactions({ raw: true });
  return list.find((tx) => tx.note === note);
};

/**
 * Where a provider-synced row lands when nothing categorizes it. `global.DEFAULT_CATEGORY_ID`
 * is just the first seeded category, while every sync path reads the user's own pointer.
 */
const userDefaultCategoryId = async () => (await helpers.getUserInfo({ raw: true })).defaultCategoryId;

// --- CSV import plumbing ---

const CSV_HEADERS = ['Date', 'Amount', 'Description', 'Category', 'Account', 'Currency', 'Type', 'Payee', 'Tags'];

interface CsvRow {
  description: string;
  category?: string;
  payee?: string;
  amount?: string;
  tag?: string;
}

const buildCsv = (rows: CsvRow[]): string =>
  [
    CSV_HEADERS.join(','),
    ...rows.map((row) =>
      [
        '2024-01-15',
        row.amount ?? '100.50',
        row.description,
        row.category ?? '',
        'CSV Account',
        global.BASE_CURRENCY_CODE,
        'expense',
        row.payee ?? '',
        row.tag ?? '',
      ].join(','),
    ),
  ].join('\n');

const buildColumnMapping = (overrides: Partial<ColumnMappingConfig> = {}): ColumnMappingConfig => ({
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
  ...overrides,
});

const runCsvImport = async (payload: {
  fileContent: string;
  columnMapping: ColumnMappingConfig;
  accountMapping: AccountMappingConfig;
  categoryMapping?: CategoryMappingConfig;
  tagMapping?: TagMappingConfig;
  defaultCategoryId?: string;
}) => {
  const { jobId } = await helpers.executeImport({
    payload: {
      fileContent: payload.fileContent,
      delimiter: ',',
      columnMapping: payload.columnMapping,
      accountMapping: payload.accountMapping,
      categoryMapping: payload.categoryMapping ?? {},
      tagMapping: payload.tagMapping,
      skipDuplicateIndices: [],
      defaultCategoryId: payload.defaultCategoryId,
    },
    raw: true,
  });

  const progress = await waitForCsvImportCompletion({ jobId });
  expectCsvImportCompleted(progress);
  return progress;
};

describe('Transaction automations hook', () => {
  it('applies note, merchant, type+amount and note-append rules to their own rows of one sync', async () => {
    const [rides, groceries, salary] = await Promise.all([
      helpers.addCustomCategory({ name: 'Rides', color: '#111111', raw: true }),
      helpers.addCustomCategory({ name: 'Groceries', color: '#222222', raw: true }),
      helpers.addCustomCategory({ name: 'Salary', color: '#eeeeee', raw: true }),
    ]);

    const uberRule = await noteRule({
      name: 'Uber is transport',
      keyword: 'uber',
      actions: [{ type: 'set_category', categoryId: rides.id }],
    });
    await helpers.createAutomation({
      payload: {
        name: 'Biedronka is groceries',
        conditions: { match: 'all', items: [{ field: 'merchant', operator: 'contains_any', value: ['biedronka'] }] },
        actions: [{ type: 'set_category', categoryId: groceries.id }],
      },
      raw: true,
    });
    await helpers.createAutomation({
      payload: {
        name: 'Big income is salary',
        conditions: {
          match: 'all',
          items: [
            { field: 'transactionType', operator: 'equals', value: TRANSACTION_TYPES.income },
            { field: 'amount', operator: 'gte', value: { min: 1000 }, currency: { mode: 'transaction' } },
          ],
        } satisfies AutomationConditions,
        actions: [{ type: 'set_category', categoryId: salary.id }],
      },
      raw: true,
    });
    await noteRule({
      name: 'note append',
      keyword: 'longnote',
      actions: [{ type: 'set_note', mode: 'append', value: 'x'.repeat(200) }],
    });

    await syncLunchFlow({
      transactions: [
        buildLunchFlowTx({ description: 'UBER TRIP 4521' }),
        buildLunchFlowTx({ merchant: 'BIEDRONKA 4102', description: 'Card payment 4102' }),
        buildLunchFlowTx({ merchant: 'Some Other Shop', description: 'Card payment 9911' }),
        buildLunchFlowTx({ description: 'payroll march', amount: asDecimal(2500) }),
        buildLunchFlowTx({ description: 'big card spend', amount: asDecimal(-2500) }),
        buildLunchFlowTx({ description: `longnote ${'y'.repeat(1900)}` }),
      ],
    });

    const defaultCategoryId = await userDefaultCategoryId();

    const transactions = await helpers.getTransactions({ raw: true });
    const byNote = (note: string) => transactions.find((tx) => tx.note === note);

    const uber = byNote('UBER TRIP 4521');
    const biedronka = byNote('Card payment 4102');
    const uncategorized = byNote('Card payment 9911');
    const payroll = byNote('payroll march');
    const bigSpend = byNote('big card spend');
    const appended = transactions.find((tx) => tx.note?.startsWith('longnote'));

    expect(uber?.categoryId).toBe(rides.id);
    expect(uber?.categorizationMeta).toMatchObject({ source: CATEGORIZATION_SOURCE.userRule, ruleId: uberRule.id });

    expect(biedronka?.categoryId).toBe(groceries.id);
    expect(uncategorized?.categoryId).toBe(defaultCategoryId);

    expect(payroll?.categoryId).toBe(salary.id);
    expect(bigSpend?.categoryId).toBe(defaultCategoryId);

    expect(appended?.note).toHaveLength(2000);
    expect(appended?.note?.endsWith('x')).toBe(true);

    const stored = await helpers.getAutomationById({ id: uberRule.id });
    expect(stored?.matchCount).toBe(1);
    expect(stored?.lastMatchedAt).not.toBeNull();
  }, 20000);

  it('leaves a manual transaction and a planned row on a connected account untouched', async () => {
    const category = await helpers.addCustomCategory({ name: 'Rides', color: '#111111', raw: true });
    const rule = await noteRule({
      name: 'Uber is transport',
      keyword: 'uber',
      actions: [{ type: 'set_category', categoryId: category.id }],
    });

    const systemAccount = await helpers.createAccount({ raw: true });
    const [manual] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: systemAccount.id, note: 'UBER TRIP manual' }),
      raw: true,
    });

    const { account } = await syncLunchFlow({ transactions: [] });
    const [planned] = await helpers.createPlannedTransaction({
      payload: { accountId: account.id, note: 'UBER TRIP planned' },
      raw: true,
    });

    expect(manual!.categoryId).toBe(global.DEFAULT_CATEGORY_ID);
    expect(manual!.categorizationMeta).toBeNull();
    expect(planned!.categoryId).toBe(global.DEFAULT_CATEGORY_ID);
    expect(planned!.categorizationMeta).toBeNull();
    expect((await helpers.getAutomationById({ id: rule.id }))?.matchCount).toBe(0);
  });

  it('applies rules to a system-account row when POST /transactions sends applyAutomations', async () => {
    const category = await helpers.addCustomCategory({ name: 'Rides', color: '#111111', raw: true });
    const rule = await noteRule({
      name: 'Uber is transport',
      keyword: 'uber',
      actions: [{ type: 'set_category', categoryId: category.id }],
    });

    const systemAccount = await helpers.createAccount({ raw: true });
    const [tx] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({ accountId: systemAccount.id, note: 'UBER TRIP via api' }),
        applyAutomations: true,
      },
      raw: true,
    });

    expect(tx!.categoryId).toBe(category.id);
    expect(tx!.categorizationMeta?.source).toBe(CATEGORIZATION_SOURCE.userRule);
    expect((await helpers.getAutomationById({ id: rule.id }))?.matchCount).toBe(1);
  });

  it("never applies another user's rule to the syncing user's row", async () => {
    const second = await helpers.signUpSecondUser();
    const foreignRule = await helpers.asUser({
      cookies: second.cookies,
      fn: async () => {
        const category = await helpers.addCustomCategory({ name: 'Foreign rides', color: '#101010', raw: true });
        return noteRule({
          name: 'foreign uber',
          keyword: 'uber',
          actions: [{ type: 'set_category', categoryId: category.id }],
        });
      },
    });

    await syncLunchFlow({ transactions: [buildLunchFlowTx({ description: 'UBER TRIP 1234' })] });

    const tx = await txByNote('UBER TRIP 1234');
    expect(tx?.categoryId).toBe(await userDefaultCategoryId());
    expect(tx?.categorizationMeta?.source).not.toBe(CATEGORIZATION_SOURCE.userRule);

    await helpers.asUser({
      cookies: second.cookies,
      fn: async () => expect((await helpers.getAutomationById({ id: foreignRule.id }))?.matchCount).toBe(0),
    });
  });

  it('matches `payee in` on an imported row and skips a row with no payee', async () => {
    const account = await helpers.createAccount({ raw: true });
    const category = await helpers.addCustomCategory({ name: 'Subscriptions', color: '#333333', raw: true });
    const payeeName = `Spotify ${generateRandomRecordId()}`;
    const payee = await helpers.createPayee({ payload: helpers.buildPayeePayload({ name: payeeName }), raw: true });

    const rule = await helpers.createAutomation({
      payload: {
        name: 'Spotify rows',
        conditions: { match: 'all', items: [{ field: 'payee', operator: 'in', value: [payee.id] }] },
        actions: [{ type: 'set_category', categoryId: category.id }],
      },
      raw: true,
    });

    await runCsvImport({
      fileContent: buildCsv([{ description: 'with-payee', payee: payeeName }, { description: 'without-payee' }]),
      columnMapping: buildColumnMapping({ payee: 'Payee' }),
      accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
      defaultCategoryId: global.DEFAULT_CATEGORY_ID,
    });

    expect((await txByNote('with-payee'))?.categoryId).toBe(category.id);
    expect((await txByNote('without-payee'))?.categoryId).toBe(global.DEFAULT_CATEGORY_ID);
    expect((await helpers.getAutomationById({ id: rule.id }))?.matchCount).toBe(1);
  });

  it('sets the payee on a synced row and applies that payee defaults', async () => {
    const token = generateRandomRecordId();
    const category = await helpers.addCustomCategory({ name: `Streaming ${token}`, color: '#666666', raw: true });
    const tag = await helpers.createTag({ payload: helpers.buildTagPayload({ name: `sub-${token}` }), raw: true });
    const payee = await helpers.createPayee({
      payload: helpers.buildPayeePayload({
        name: `Netflix ${token}`,
        defaultCategoryId: category.id,
        categorizationMode: CATEGORIZATION_MODE.enforce,
        defaultTagIds: [tag.id],
      }),
      raw: true,
    });

    const rule = await noteRule({
      name: 'Netflix payee',
      keyword: 'netflix',
      actions: [{ type: 'set_payee', payeeId: payee.id }],
    });

    await syncLunchFlow({ transactions: [buildLunchFlowTx({ description: 'NETFLIX 8891' })] });

    const tx = await txByNote('NETFLIX 8891');
    expect(tx?.payeeId).toBe(payee.id);
    expect(tx?.payeeLocked).toBe(true);
    expect(tx?.categoryId).toBe(category.id);
    expect(tx?.categorizationMeta?.source).toBe(CATEGORIZATION_SOURCE.payeeRule);
    expect(tx?.tags?.map((item) => item.id)).toEqual([tag.id]);
    expect((await helpers.getAutomationById({ id: rule.id }))?.matchCount).toBe(1);
  });

  it('keeps an explicitly mapped import category but still applies tags and bumps the counter', async () => {
    const account = await helpers.createAccount({ raw: true });
    const token = generateRandomRecordId();
    const mappedCategory = await helpers.addCustomCategory({ name: `Mapped ${token}`, color: '#444444', raw: true });
    const ruleCategory = await helpers.addCustomCategory({ name: `Rule ${token}`, color: '#555555', raw: true });
    const tag = await helpers.createTag({ payload: helpers.buildTagPayload({ name: `auto-${token}` }), raw: true });

    const rule = await noteRule({
      name: 'Fuel rows',
      keyword: 'fuel',
      actions: [
        { type: 'set_category', categoryId: ruleCategory.id },
        { type: 'add_tags', tagIds: [tag.id] },
      ],
    });

    await runCsvImport({
      fileContent: buildCsv([
        { description: 'fuel-mapped', category: `Mapped ${token}` },
        { description: 'fuel-default' },
      ]),
      columnMapping: buildColumnMapping(),
      accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
      categoryMapping: { [`Mapped ${token}`]: { action: 'link-existing', categoryId: mappedCategory.id } },
    });

    const mapped = await txByNote('fuel-mapped');
    expect(mapped?.categoryId).toBe(mappedCategory.id);
    expect(mapped?.categorizationMeta).toBeNull();
    expect(mapped?.tags?.map((item) => item.id)).toEqual([tag.id]);

    const fallback = await txByNote('fuel-default');
    expect(fallback?.categoryId).toBe(ruleCategory.id);
    expect(fallback?.categorizationMeta).toMatchObject({ source: CATEGORIZATION_SOURCE.userRule });

    expect((await helpers.getAutomationById({ id: rule.id }))?.matchCount).toBe(2);
  });

  it('falls through to the next rule when the first match applied nothing', async () => {
    const account = await helpers.createAccount({ raw: true });
    const token = generateRandomRecordId();
    const mappedCategory = await helpers.addCustomCategory({ name: `Mapped ${token}`, color: '#444444', raw: true });
    const ruleCategory = await helpers.addCustomCategory({ name: `Rule ${token}`, color: '#555555', raw: true });
    const tag = await helpers.createTag({ payload: helpers.buildTagPayload({ name: `auto-${token}` }), raw: true });

    const categoryOnly = await noteRule({
      name: 'Fuel category',
      keyword: 'fuel',
      actions: [{ type: 'set_category', categoryId: ruleCategory.id }],
    });
    const tagOnly = await noteRule({
      name: 'Fuel tag',
      keyword: 'fuel',
      actions: [{ type: 'add_tags', tagIds: [tag.id] }],
    });

    await runCsvImport({
      fileContent: buildCsv([{ description: 'fuel-mapped', category: `Mapped ${token}` }]),
      columnMapping: buildColumnMapping(),
      accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
      categoryMapping: { [`Mapped ${token}`]: { action: 'link-existing', categoryId: mappedCategory.id } },
    });

    const row = await txByNote('fuel-mapped');
    expect(row?.categoryId).toBe(mappedCategory.id);
    expect(row?.tags?.map((item) => item.id)).toEqual([tag.id]);
    expect((await helpers.getAutomationById({ id: categoryOnly.id }))?.matchCount).toBe(0);
    expect((await helpers.getAutomationById({ id: tagOnly.id }))?.matchCount).toBe(1);
  });

  it('leaves a row that confirmed a planned transaction untouched', async () => {
    const account = await helpers.createAccount({ raw: true });
    const token = generateRandomRecordId();
    const ruleCategory = await helpers.addCustomCategory({ name: `Rule ${token}`, color: '#555555', raw: true });
    const rule = await noteRule({
      name: 'Rent rows',
      keyword: 'rent',
      actions: [{ type: 'set_category', categoryId: ruleCategory.id }],
    });

    const [plan] = await helpers.createPlannedTransaction({
      payload: { accountId: account.id, amount: 100.5, time: '2024-01-17T00:00:00.000Z', note: 'Rent plan' },
      raw: true,
    });

    await runCsvImport({
      fileContent: buildCsv([{ description: 'rent-payment' }]),
      columnMapping: buildColumnMapping(),
      accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
    });

    const merged = await helpers.getTransactionById({ id: plan!.id, raw: true });
    expect(merged?.isPlanned).toBe(false);
    expect(merged?.categoryId).toBe(plan!.categoryId);
    expect(merged?.categorizationMeta).toBeNull();
    expect((await helpers.getAutomationById({ id: rule.id }))?.matchCount).toBe(0);
  });

  it('keeps a YNAB-mapped category but still applies the rule tags', async () => {
    const token = generateRandomRecordId();
    const ruleCategory = await helpers.addCustomCategory({ name: `Rule ${token}`, color: '#555555', raw: true });
    const tag = await helpers.createTag({ payload: helpers.buildTagPayload({ name: `ynab-${token}` }), raw: true });

    const rule = await noteRule({
      name: 'Electric rows',
      keyword: 'electric',
      actions: [
        { type: 'set_category', categoryId: ruleCategory.id },
        { type: 'add_tags', tagIds: [tag.id] },
      ],
    });

    const fileContent = helpers.loadYnabFixture('register-basic.csv');
    const parsed = await helpers.parseYnab({ payload: { fileContent }, raw: true });
    const accountMapping = Object.fromEntries(
      parsed.result.accounts.map((account) => [account.originalName, { currencyCode: account.detectedCurrency! }]),
    );
    const { jobId } = await helpers.executeYnab({ payload: { fileContent, accountMapping }, raw: true });
    expectYnabImportCompleted(await waitForYnabImportCompletion({ jobId }));

    const utilities = (await helpers.getCategoriesList()).find((category) => category.name === 'Utilities');
    const electric = await txByNote('Electric bill');
    expect(electric?.categoryId).toBe(utilities?.id);
    expect(electric?.categorizationMeta).toBeNull();
    // The fixture row also carries a YNAB flag, which the import maps to its own tag.
    expect(electric?.tags?.map((item) => item.id)).toContain(tag.id);
    expect((await helpers.getAutomationById({ id: rule.id }))?.matchCount).toBe(1);
  });

  it('leaves a subscription-claimed category alone but still applies the rule tags', async () => {
    const account = await helpers.createAccount({ raw: true });
    const token = generateRandomRecordId();
    const subscriptionCategory = await helpers.addCustomCategory({ name: `Sub ${token}`, color: '#666666', raw: true });
    const ruleCategory = await helpers.addCustomCategory({ name: `Rule ${token}`, color: '#777777', raw: true });
    const tag = await helpers.createTag({ payload: helpers.buildTagPayload({ name: `sub-${token}` }), raw: true });

    await helpers.createSubscription({
      name: 'Netflix',
      type: SUBSCRIPTION_TYPES.subscription,
      expectedAmount: 100.5,
      expectedCurrencyCode: global.BASE_CURRENCY_CODE,
      frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      startDate: '2024-01-01',
      accountId: account.id,
      categoryId: subscriptionCategory.id,
      matchingRules: { rules: [{ field: 'note', operator: 'contains_any', value: ['netflix'] }] },
      raw: true,
    });

    const rule = await noteRule({
      name: 'Netflix rows',
      keyword: 'netflix',
      actions: [
        { type: 'set_category', categoryId: ruleCategory.id },
        { type: 'add_tags', tagIds: [tag.id] },
      ],
    });

    await runCsvImport({
      fileContent: buildCsv([{ description: 'netflix monthly' }]),
      columnMapping: buildColumnMapping(),
      accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
    });

    const tx = await txByNote('netflix monthly');
    expect(tx?.categoryId).toBe(subscriptionCategory.id);
    expect(tx?.categorizationMeta).toMatchObject({ source: CATEGORIZATION_SOURCE.subscriptionRule });
    expect(tx?.tags?.map((item) => item.id)).toEqual([tag.id]);
    expect((await helpers.getAutomationById({ id: rule.id }))?.matchCount).toBe(1);
  });

  it('categorizes a matching Monobank row and leaves the rest unstamped', async () => {
    const category = await helpers.addCustomCategory({ name: 'Groceries', color: '#888888', raw: true });
    await noteRule({
      name: 'Auchan is groceries',
      keyword: 'auchan match',
      actions: [{ type: 'set_category', categoryId: category.id }],
    });

    const { account } = await helpers.monobank.mockTransactions({
      transactions: [
        { mcc: 5411, originalMcc: 5411, description: 'mcc control', time: subDays(new Date(), 2) },
        { mcc: 5411, originalMcc: 5411, description: 'auchan match', time: subDays(new Date(), 1) },
      ],
    });

    const rows = await helpers.getTransactions({ accountIds: [account.id], raw: true });

    const control = rows.find((tx) => tx.note === 'mcc control');
    expect(control?.categoryId).toBe(await userDefaultCategoryId());
    expect(control?.categorizationMeta).toBeNull();

    const matched = rows.find((tx) => tx.note === 'auchan match');
    expect(matched?.categoryId).toBe(category.id);
    expect(matched?.categorizationMeta).toMatchObject({ source: CATEGORIZATION_SOURCE.userRule });
  });

  it('applies only the highest matching rule, and the other one after a reorder', async () => {
    const token = generateRandomRecordId();
    const [first, second] = await Promise.all([
      helpers.addCustomCategory({ name: `First ${token}`, color: '#999999', raw: true }),
      helpers.addCustomCategory({ name: `Second ${token}`, color: '#aaaaaa', raw: true }),
    ]);

    const topRule = await noteRule({
      name: 'top',
      keyword: 'overlap',
      actions: [{ type: 'set_category', categoryId: first.id }],
    });
    const bottomRule = await noteRule({
      name: 'bottom',
      keyword: 'overlap',
      actions: [{ type: 'set_category', categoryId: second.id }],
    });

    const { connectionId, account } = await syncLunchFlow({
      transactions: [buildLunchFlowTx({ description: 'overlap one' })],
    });
    expect((await txByNote('overlap one'))?.categoryId).toBe(first.id);

    await helpers.reorderAutomations({ payload: { ids: [bottomRule.id, topRule.id] }, raw: true });

    global.mswMockServer.use(
      getLunchFlowTransactionsMock({
        response: { transactions: [buildLunchFlowTx({ description: 'overlap two' })], total: 1 },
      }),
      getLunchFlowBalanceMock(),
    );
    await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId: account.id, raw: true });

    expect((await txByNote('overlap two'))?.categoryId).toBe(second.id);
  });

  it("survives two of the user's accounts syncing concurrently against the same rules", async () => {
    const token = generateRandomRecordId();
    const [first, second] = await Promise.all([
      helpers.addCustomCategory({ name: `Alpha ${token}`, color: '#bbbbbb', raw: true }),
      helpers.addCustomCategory({ name: `Beta ${token}`, color: '#cccccc', raw: true }),
    ]);
    await noteRule({ name: 'alpha', keyword: 'alpha', actions: [{ type: 'set_category', categoryId: first.id }] });
    await noteRule({ name: 'beta', keyword: 'beta', actions: [{ type: 'set_category', categoryId: second.id }] });

    const { connectionId } = await helpers.lunchflow.pair();
    const { accounts } = await helpers.bankDataProviders.listExternalAccounts({ connectionId, raw: true });

    // Both accounts pinned to the base currency so the sync never needs a cross-rate.
    const usdBalance = { balance: { amount: asDecimal(1000), currency: 'USD' } };
    global.mswMockServer.use(
      getLunchFlowTransactionsMock({ response: { transactions: [], total: 0 } }),
      ...accounts.map((account) => getLunchFlowBalanceMock({ accountId: account.externalId, response: usdBalance })),
    );

    const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
      connectionId,
      accountExternalIds: accounts.map((account) => account.externalId),
      raw: true,
    });

    global.mswMockServer.use(
      getLunchFlowTransactionsMock({
        accountId: accounts[0]!.externalId,
        response: {
          transactions: [
            buildLunchFlowTx({ description: 'alpha a', accountId: Number(accounts[0]!.externalId) }),
            buildLunchFlowTx({ description: 'beta a', accountId: Number(accounts[0]!.externalId) }),
          ],
          total: 2,
        },
      }),
      getLunchFlowTransactionsMock({
        accountId: accounts[1]!.externalId,
        response: {
          transactions: [
            buildLunchFlowTx({ description: 'alpha b', accountId: Number(accounts[1]!.externalId) }),
            buildLunchFlowTx({ description: 'beta b', accountId: Number(accounts[1]!.externalId) }),
          ],
          total: 2,
        },
      }),
    );

    await Promise.all(
      syncedAccounts.map((account) =>
        helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId: account.id, raw: true }),
      ),
    );

    expect((await txByNote('alpha a'))?.categoryId).toBe(first.id);
    expect((await txByNote('beta a'))?.categoryId).toBe(second.id);
    expect((await txByNote('alpha b'))?.categoryId).toBe(first.id);
    expect((await txByNote('beta b'))?.categoryId).toBe(second.id);
  });

  it('re-adding a tag the imported row already carries is a no-op', async () => {
    const token = generateRandomRecordId();
    const account = await helpers.createAccount({ raw: true });
    const tag = await helpers.createTag({ payload: helpers.buildTagPayload({ name: `dupe-${token}` }), raw: true });

    const rule = await noteRule({
      name: 'tag rows',
      keyword: 'dupetag',
      actions: [{ type: 'add_tags', tagIds: [tag.id] }],
    });

    await runCsvImport({
      fileContent: buildCsv([{ description: 'dupetag row', tag: `Src ${token}` }]),
      columnMapping: buildColumnMapping({ tags: { option: TagOptionValue.mapDataSourceColumn, columnName: 'Tags' } }),
      accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
      tagMapping: { [`Src ${token}`]: { action: 'link-existing', tagId: tag.id } },
    });

    const tx = await txByNote('dupetag row');
    expect(tx?.tags?.map((item) => item.id)).toEqual([tag.id]);
    expect((await helpers.getAutomationById({ id: rule.id }))?.matchCount).toBe(1);
  });

  describe('AI categorization candidates', () => {
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

    it('drops a rule-stamped row from the AI candidate list and keeps the unmatched one', async () => {
      const category = await helpers.addCustomCategory({ name: 'Rides', color: '#dddddd', raw: true });
      await noteRule({
        name: 'Uber is transport',
        keyword: 'uber',
        actions: [{ type: 'set_category', categoryId: category.id }],
      });

      await syncLunchFlow({
        transactions: [
          buildLunchFlowTx({ description: 'UBER TRIP 7788' }),
          buildLunchFlowTx({ description: 'Bakery on the corner' }),
        ],
      });

      const candidates = await helpers.getAiCategorizationCandidates({ raw: true });
      const notes = candidates.items.map((item) => item.note);
      expect(notes).toContain('Bakery on the corner');
      expect(notes).not.toContain('UBER TRIP 7788');
    });
  });
});
