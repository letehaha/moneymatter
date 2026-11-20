import type { AccountMappingConfig, AutomationAction, ColumnMappingConfig, RecordId } from '@bt/shared/types';
import {
  AUTOMATION_LIMITS,
  AccountOptionValue,
  CATEGORIZATION_SOURCE,
  CategoryOptionValue,
  CurrencyOptionValue,
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_TYPES,
  TRANSACTION_TRANSFER_NATURE,
  TransactionTypeOptionValue,
} from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { expectCsvImportCompleted, waitForCsvImportCompletion } from '@tests/helpers/import-export';

const CSV_HEADERS = ['Date', 'Amount', 'Description', 'Category', 'Account', 'Currency', 'Type'];

const columnMapping: ColumnMappingConfig = {
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
};

/** Imported rows carry `externalData.importDetails`, which is what makes them automation-eligible. */
const importRows = async ({ descriptions, accountId }: { descriptions: string[]; accountId?: string }) => {
  const target = accountId ?? (await helpers.createAccount({ raw: true })).id;
  const accountMapping: AccountMappingConfig = {
    'CSV Account': { action: 'link-existing', accountId: target },
  };

  const { jobId } = await helpers.executeImport({
    payload: {
      fileContent: [
        CSV_HEADERS.join(','),
        ...descriptions.map((description) =>
          ['2024-01-15', '100.50', description, '', 'CSV Account', global.BASE_CURRENCY_CODE, 'expense'].join(','),
        ),
      ].join('\n'),
      delimiter: ',',
      columnMapping,
      accountMapping,
      categoryMapping: {},
      skipDuplicateIndices: [],
    },
    raw: true,
  });

  expectCsvImportCompleted(await waitForCsvImportCompletion({ jobId }));

  const transactions = await helpers.getTransactions({ raw: true });
  return (note: string) => transactions.find((tx) => tx.note === note)!.id as RecordId;
};

const uberRule = ({ actions, isEnabled }: { actions: AutomationAction[]; isEnabled?: boolean }) =>
  helpers.createAutomation({
    payload: {
      name: 'Uber is transport',
      isEnabled,
      conditions: { match: 'all', items: [{ field: 'note', operator: 'contains_any', value: ['uber'] }] },
      actions,
    },
    raw: true,
  });

const txByNote = async (note: string) => (await helpers.getTransactions({ raw: true })).find((tx) => tx.note === note);

describe('POST /automations/:id/apply', () => {
  it('applies to a system-account row created via POST /transactions with applyAutomations', async () => {
    const account = await helpers.createAccount({ raw: true });
    const [tx] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({ accountId: account.id, note: 'uber later' }),
        applyAutomations: true,
      },
      raw: true,
    });
    const category = await helpers.addCustomCategory({ name: 'Rides', color: '#111111', raw: true });
    const rule = await uberRule({ actions: [{ type: 'set_category', categoryId: category.id as RecordId }] });

    const result = await helpers.applyAutomationToHistory({
      id: rule.id,
      payload: { transactionIds: [tx!.id as RecordId] },
      raw: true,
    });

    expect(result.appliedCount).toBe(1);
    expect(result.skippedIds).toEqual([]);
    expect((await txByNote('uber later'))?.categoryId).toBe(category.id);
  });

  it('categorizes every submitted match under one shared stamp and leaves matchCount alone', async () => {
    const idOf = await importRows({ descriptions: ['uber one', 'uber two', 'grocery run'] });
    const category = await helpers.addCustomCategory({ name: 'Rides', color: '#111111', raw: true });
    const rule = await uberRule({ actions: [{ type: 'set_category', categoryId: category.id as RecordId }] });

    const result = await helpers.applyAutomationToHistory({
      id: rule.id,
      payload: { transactionIds: [idOf('uber one'), idOf('uber two')] },
      raw: true,
    });

    expect(result.appliedCount).toBe(2);
    expect(result.skippedIds).toEqual([]);
    expect(Number.isNaN(Date.parse(result.categorizedAt))).toBe(false);

    for (const note of ['uber one', 'uber two']) {
      const row = await txByNote(note);
      expect(row?.categoryId).toBe(category.id);
      expect(row?.categorizationMeta).toMatchObject({
        source: CATEGORIZATION_SOURCE.userRule,
        ruleId: rule.id,
        categorizedAt: result.categorizedAt,
      });
    }

    expect((await txByNote('grocery run'))?.categorizationMeta).toBeNull();
    expect((await helpers.getAutomationById({ id: rule.id }))?.matchCount).toBe(0);
  });

  it('skips a manually categorized row, a non-matching id and another user row', async () => {
    const idOf = await importRows({ descriptions: ['uber one', 'uber two', 'grocery run'] });
    const [ruleCategory, manualCategory] = await Promise.all([
      helpers.addCustomCategory({ name: 'Rides', color: '#111111', raw: true }),
      helpers.addCustomCategory({ name: 'Chosen', color: '#222222', raw: true }),
    ]);

    await helpers.updateTransaction({ id: idOf('uber two'), payload: { categoryId: manualCategory.id }, raw: true });

    const second = await helpers.signUpSecondUser();
    const foreignId = await helpers.asUser({
      cookies: second.cookies,
      fn: async () => {
        await helpers.setBaseCurrencyForActiveUser({ currencyCode: global.BASE_CURRENCY.code });
        const account = await helpers.createAccount({ raw: true });
        const category = await helpers.addCustomCategory({ name: 'foreign', color: '#ff00ff', raw: true });
        const [transaction] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: category.id,
            note: 'uber foreign',
          }),
          raw: true,
        });
        return transaction.id as RecordId;
      },
    });

    const rule = await uberRule({ actions: [{ type: 'set_category', categoryId: ruleCategory.id as RecordId }] });
    const submitted = [idOf('uber one'), idOf('uber two'), idOf('grocery run'), foreignId];

    const result = await helpers.applyAutomationToHistory({
      id: rule.id,
      payload: { transactionIds: submitted },
      raw: true,
    });

    expect(result.appliedCount).toBe(1);
    expect(result.skippedIds).toEqual([idOf('uber two'), idOf('grocery run'), foreignId]);
    expect((await txByNote('uber one'))?.categoryId).toBe(ruleCategory.id);

    const manual = await txByNote('uber two');
    expect(manual?.categoryId).toBe(manualCategory.id);
    expect(manual?.categorizationMeta?.source).toBe(CATEGORIZATION_SOURCE.manual);
  });

  it('applies an add_tags rule to the submitted rows', async () => {
    const idOf = await importRows({ descriptions: ['uber one'] });
    const tag = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'commute' }), raw: true });
    const rule = await uberRule({ actions: [{ type: 'add_tags', tagIds: [tag.id as RecordId] }] });

    const result = await helpers.applyAutomationToHistory({
      id: rule.id,
      payload: { transactionIds: [idOf('uber one')] },
      raw: true,
    });

    expect(result.appliedCount).toBe(1);
    expect((await txByNote('uber one'))?.tags?.map((item) => item.id)).toEqual([tag.id]);
  });

  it('404s an unknown rule', async () => {
    const idOf = await importRows({ descriptions: ['uber one'] });

    const unknown = await helpers.applyAutomationToHistory({
      id: generateRandomRecordId(),
      payload: { transactionIds: [idOf('uber one')] },
    });

    expect(unknown.statusCode).toBe(404);
  });

  it('422s a rule whose category was deleted', async () => {
    const idOf = await importRows({ descriptions: ['uber one'] });
    const category = await helpers.addCustomCategory({ name: 'Doomed', color: '#333333', raw: true });
    const rule = await uberRule({ actions: [{ type: 'set_category', categoryId: category.id as RecordId }] });
    await helpers.deleteCustomCategory({ categoryId: category.id });

    const stale = await helpers.applyAutomationToHistory({
      id: rule.id,
      payload: { transactionIds: [idOf('uber one')] },
    });

    expect(stale.statusCode).toBe(422);
    expect((await txByNote('uber one'))?.categorizationMeta).toBeNull();
  });

  it('leaves a subscription-claimed category alone and reports the row as skipped', async () => {
    const account = await helpers.createAccount({ raw: true });
    const [subscriptionCategory, ruleCategory] = await Promise.all([
      helpers.addCustomCategory({ name: 'Streaming', color: '#444444', raw: true }),
      helpers.addCustomCategory({ name: 'Rides', color: '#111111', raw: true }),
    ]);

    await helpers.createSubscription({
      name: 'Ride pass',
      type: SUBSCRIPTION_TYPES.subscription,
      expectedAmount: 100.5,
      expectedCurrencyCode: global.BASE_CURRENCY_CODE,
      frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      startDate: '2024-01-01',
      accountId: account.id,
      categoryId: subscriptionCategory.id,
      matchingRules: { rules: [{ field: 'note', operator: 'contains_any', value: ['uber'] }] },
      raw: true,
    });

    const idOf = await importRows({ descriptions: ['uber one'], accountId: account.id });
    const rule = await uberRule({ actions: [{ type: 'set_category', categoryId: ruleCategory.id as RecordId }] });

    const result = await helpers.applyAutomationToHistory({
      id: rule.id,
      payload: { transactionIds: [idOf('uber one')] },
      raw: true,
    });

    expect(result.appliedCount).toBe(0);
    expect(result.skippedIds).toEqual([idOf('uber one')]);

    const row = await txByNote('uber one');
    expect(row?.categoryId).toBe(subscriptionCategory.id);
    expect(row?.categorizationMeta?.source).toBe(CATEGORIZATION_SOURCE.subscriptionRule);
  });

  it('skips own rows the scan never returns: manual, transfer leg and planned', async () => {
    const idOf = await importRows({ descriptions: ['uber one'] });
    const systemAccount = await helpers.createAccount({ raw: true });
    const transferTarget = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ name: 'transfer target' }),
      raw: true,
    });

    const [manual] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: systemAccount.id, note: 'uber manual' }),
      raw: true,
    });
    const [transfer] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({ accountId: systemAccount.id, amount: 5000, note: 'uber transfer' }),
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationAmount: 5000,
        destinationAccountId: transferTarget.id,
      },
      raw: true,
    });
    const [planned] = await helpers.createPlannedTransaction({
      payload: { accountId: systemAccount.id, note: 'uber planned', time: new Date().toISOString() },
      raw: true,
    });

    const category = await helpers.addCustomCategory({ name: 'Rides', color: '#111111', raw: true });
    const rule = await uberRule({ actions: [{ type: 'set_category', categoryId: category.id as RecordId }] });
    const ineligible = [manual.id, transfer.id, planned.id] as RecordId[];

    const result = await helpers.applyAutomationToHistory({
      id: rule.id,
      payload: { transactionIds: [idOf('uber one'), ...ineligible] },
      raw: true,
    });

    expect(result.appliedCount).toBe(1);
    expect(result.skippedIds).toEqual(ineligible);

    for (const note of ['uber manual', 'uber transfer', 'uber planned']) {
      expect((await txByNote(note))?.categorizationMeta).toBeNull();
    }
  });

  it('applies a disabled rule', async () => {
    const idOf = await importRows({ descriptions: ['uber one'] });
    const category = await helpers.addCustomCategory({ name: 'Rides', color: '#111111', raw: true });
    const rule = await uberRule({
      actions: [{ type: 'set_category', categoryId: category.id as RecordId }],
      isEnabled: false,
    });

    const result = await helpers.applyAutomationToHistory({
      id: rule.id,
      payload: { transactionIds: [idOf('uber one')] },
      raw: true,
    });

    expect(result.appliedCount).toBe(1);
    expect((await txByNote('uber one'))?.categoryId).toBe(category.id);
  });

  it('rewrites the same stamp when the rule is applied twice', async () => {
    const idOf = await importRows({ descriptions: ['uber one'] });
    const category = await helpers.addCustomCategory({ name: 'Rides', color: '#111111', raw: true });
    const rule = await uberRule({ actions: [{ type: 'set_category', categoryId: category.id as RecordId }] });
    const transactionIds = [idOf('uber one')];

    const first = await helpers.applyAutomationToHistory({ id: rule.id, payload: { transactionIds }, raw: true });
    const second = await helpers.applyAutomationToHistory({ id: rule.id, payload: { transactionIds }, raw: true });

    expect(first.appliedCount).toBe(1);
    expect(second.appliedCount).toBe(1);
    expect(second.skippedIds).toEqual([]);

    expect((await txByNote('uber one'))?.categorizationMeta).toMatchObject({
      source: CATEGORIZATION_SOURCE.userRule,
      ruleId: rule.id,
      categorizedAt: second.categorizedAt,
    });
  });

  it('tags a protected row while leaving its category and source alone', async () => {
    const idOf = await importRows({ descriptions: ['uber one'] });
    const [manualCategory, ruleCategory] = await Promise.all([
      helpers.addCustomCategory({ name: 'Chosen', color: '#222222', raw: true }),
      helpers.addCustomCategory({ name: 'Rides', color: '#111111', raw: true }),
    ]);
    await helpers.updateTransaction({ id: idOf('uber one'), payload: { categoryId: manualCategory.id }, raw: true });

    const tag = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'commute' }), raw: true });
    const rule = await uberRule({
      actions: [
        { type: 'set_category', categoryId: ruleCategory.id as RecordId },
        { type: 'add_tags', tagIds: [tag.id as RecordId] },
      ],
    });

    const result = await helpers.applyAutomationToHistory({
      id: rule.id,
      payload: { transactionIds: [idOf('uber one')] },
      raw: true,
    });

    expect(result.appliedCount).toBe(1);
    expect(result.skippedIds).toEqual([]);

    const row = await txByNote('uber one');
    expect(row?.categoryId).toBe(manualCategory.id);
    expect(row?.categorizationMeta?.source).toBe(CATEGORIZATION_SOURCE.manual);
    expect(row?.tags?.map((item) => item.id)).toEqual([tag.id]);
  });

  it('never previews or applies a split parent', async () => {
    const idOf = await importRows({ descriptions: ['uber split', 'uber plain'] });
    const [splitCategory, ruleCategory] = await Promise.all([
      helpers.addCustomCategory({ name: 'Split part', color: '#555555', raw: true }),
      helpers.addCustomCategory({ name: 'Rides', color: '#111111', raw: true }),
    ]);

    const splitParentId = idOf('uber split');
    await helpers.updateTransaction({
      id: splitParentId,
      payload: { splits: [{ categoryId: splitCategory.id, amount: 50 }] },
      raw: true,
    });
    const beforeApply = await txByNote('uber split');

    const rule = await uberRule({ actions: [{ type: 'set_category', categoryId: ruleCategory.id as RecordId }] });

    const preview = await helpers.previewAutomation({ payload: { automationId: rule.id }, raw: true });

    expect(preview.matchedCount).toBe(1);
    expect(preview.matches.map((match) => match.note)).toEqual(['uber plain']);

    const result = await helpers.applyAutomationToHistory({
      id: rule.id,
      payload: { transactionIds: [splitParentId, idOf('uber plain')] },
      raw: true,
    });

    expect(result.appliedCount).toBe(1);
    expect(result.skippedIds).toEqual([splitParentId]);
    expect((await txByNote('uber split'))?.categoryId).toBe(beforeApply?.categoryId);
    expect((await txByNote('uber plain'))?.categoryId).toBe(ruleCategory.id);
  });

  it('sets and locks the payee of the submitted rows', async () => {
    const idOf = await importRows({ descriptions: ['uber one'] });
    const payee = await helpers.createPayee({ payload: helpers.buildPayeePayload({ name: 'Uber BV' }), raw: true });
    const rule = await uberRule({ actions: [{ type: 'set_payee', payeeId: payee.id }] });

    const result = await helpers.applyAutomationToHistory({
      id: rule.id,
      payload: { transactionIds: [idOf('uber one')] },
      raw: true,
    });

    expect(result.appliedCount).toBe(1);

    const row = await txByNote('uber one');
    expect(row?.payeeId).toBe(payee.id);
    expect(row?.payeeLocked).toBe(true);
  });

  it('hides a row from the preview once its tags, payee and note all carry the rule result', async () => {
    const idOf = await importRows({ descriptions: ['uber one', 'uber two'] });
    const tag = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'commute' }), raw: true });
    const payee = await helpers.createPayee({ payload: helpers.buildPayeePayload({ name: 'Uber BV' }), raw: true });
    const rule = await uberRule({
      actions: [
        { type: 'add_tags', tagIds: [tag.id as RecordId] },
        { type: 'set_payee', payeeId: payee.id },
        { type: 'set_note', mode: 'append', value: 'checked' },
      ],
    });

    await helpers.applyAutomationToHistory({ id: rule.id, payload: { transactionIds: [idOf('uber one')] }, raw: true });

    const result = await helpers.previewAutomation({ payload: { automationId: rule.id }, raw: true });

    expect(result.matchedCount).toBe(1);
    expect(result.matches.map((tx) => tx.note)).toEqual(['uber two']);
  });

  it('hides a manually categorized row from a category-only preview but lists it for a mixed rule', async () => {
    const idOf = await importRows({ descriptions: ['uber one', 'uber two'] });
    const [ruleCategory, manualCategory] = await Promise.all([
      helpers.addCustomCategory({ name: 'Rides', color: '#111111', raw: true }),
      helpers.addCustomCategory({ name: 'Chosen', color: '#222222', raw: true }),
    ]);
    const tag = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'commute' }), raw: true });

    await helpers.updateTransaction({ id: idOf('uber two'), payload: { categoryId: manualCategory.id }, raw: true });

    const categoryOnly = await uberRule({
      actions: [{ type: 'set_category', categoryId: ruleCategory.id as RecordId }],
    });
    const preview = await helpers.previewAutomation({ payload: { automationId: categoryOnly.id }, raw: true });

    expect(preview).toMatchObject({ matchedCount: 1, settledCount: 1 });
    expect(preview.matches.map((tx) => tx.note)).toEqual(['uber one']);

    const mixed = await uberRule({
      actions: [
        { type: 'set_category', categoryId: ruleCategory.id as RecordId },
        { type: 'add_tags', tagIds: [tag.id as RecordId] },
      ],
    });
    const mixedPreview = await helpers.previewAutomation({ payload: { automationId: mixed.id }, raw: true });

    expect(mixedPreview.matchedCount).toBe(2);
  });

  it('accepts the maximum id list and the maximum preview limit', async () => {
    const idOf = await importRows({ descriptions: ['uber one'] });
    const category = await helpers.addCustomCategory({ name: 'Rides', color: '#111111', raw: true });
    const rule = await uberRule({ actions: [{ type: 'set_category', categoryId: category.id as RecordId }] });

    const transactionIds = [
      idOf('uber one'),
      ...Array.from({ length: AUTOMATION_LIMITS.maxApplyIds - 1 }, () => generateRandomRecordId()),
    ];

    const result = await helpers.applyAutomationToHistory({ id: rule.id, payload: { transactionIds }, raw: true });

    expect(result.appliedCount).toBe(1);
    expect(result.skippedIds).toHaveLength(AUTOMATION_LIMITS.maxApplyIds - 1);

    const preview = await helpers.previewAutomation({
      payload: { automationId: rule.id, limit: AUTOMATION_LIMITS.maxApplyIds },
    });

    expect(preview.statusCode).toBe(200);
  });

  it('rejects an empty, oversized or duplicated transactionIds list', async () => {
    const category = await helpers.addCustomCategory({ name: 'Rides', color: '#111111', raw: true });
    const rule = await uberRule({ actions: [{ type: 'set_category', categoryId: category.id as RecordId }] });
    const duplicated = generateRandomRecordId();

    for (const transactionIds of [
      [],
      Array.from({ length: 501 }, () => generateRandomRecordId()),
      [duplicated, duplicated],
    ]) {
      expect((await helpers.applyAutomationToHistory({ id: rule.id, payload: { transactionIds } })).statusCode).toBe(
        422,
      );
    }
  });
});
