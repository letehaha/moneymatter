import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  type CreateTransactionTemplateBody,
  PAYMENT_TYPES,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

const buildPayload = (overrides: Partial<CreateTransactionTemplateBody> = {}): CreateTransactionTemplateBody => ({
  name: 'Groceries',
  transactionType: TRANSACTION_TYPES.expense,
  ...overrides,
});

describe('Transaction templates', () => {
  describe('GET /transaction-templates', () => {
    it('returns an empty list when the user has no templates', async () => {
      const templates = await helpers.getTransactionTemplates({ raw: true });

      expect(templates).toEqual([]);
    });

    it('returns templates in createdAt ASC order with their tags', async () => {
      const account = await helpers.createAccount({ raw: true });
      const category = await helpers.addCustomCategory({ name: 'Food', color: '#AABBCC', raw: true });
      const payee = await helpers.createPayee({ payload: helpers.buildPayeePayload({ name: 'Lidl' }), raw: true });
      const tagA = await helpers.createTag({ payload: { name: 'weekly', color: '#111111' }, raw: true });
      const tagB = await helpers.createTag({ payload: { name: 'household', color: '#222222' }, raw: true });

      await helpers.createTransactionTemplate({
        payload: buildPayload({
          name: 'Groceries',
          amount: 42.5,
          accountId: account.id,
          categoryId: category.id,
          payeeId: payee.id,
          paymentType: PAYMENT_TYPES.debitCard,
          note: 'weekly run',
          tagIds: [tagA.id, tagB.id],
        }),
        raw: true,
      });
      await helpers.createTransactionTemplate({
        payload: buildPayload({ name: 'Salary', transactionType: TRANSACTION_TYPES.income }),
        raw: true,
      });

      const templates = await helpers.getTransactionTemplates({ raw: true });

      expect(templates.map((tpl) => tpl.name)).toEqual(['Groceries', 'Salary']);

      const [groceries, salary] = templates;
      expect(groceries!.amount).toBe(42.5);
      expect(groceries!.accountId).toBe(account.id);
      expect(groceries!.categoryId).toBe(category.id);
      expect(groceries!.payeeId).toBe(payee.id);
      expect(groceries!.paymentType).toBe(PAYMENT_TYPES.debitCard);
      expect(groceries!.note).toBe('weekly run');
      expect(groceries!.tagIds.toSorted()).toEqual([tagA.id, tagB.id].toSorted());

      expect(salary!.transactionType).toBe(TRANSACTION_TYPES.income);
      expect(salary!.amount).toBeNull();
      expect(salary!.tagIds).toEqual([]);
    });
  });

  describe('POST /transaction-templates', () => {
    it('round-trips a null amount', async () => {
      const created = await helpers.createTransactionTemplate({ payload: buildPayload(), raw: true });
      expect(created.amount).toBeNull();

      const [fetched] = await helpers.getTransactionTemplates({ raw: true });
      expect(fetched!.amount).toBeNull();
    });

    it('stores the original currency, keeps it on a partial update, clears it on null and rejects a non-ISO code', async () => {
      const created = await helpers.createTransactionTemplate({
        payload: buildPayload({ originalCurrencyCode: 'eur' }),
        raw: true,
      });
      expect(created.originalCurrencyCode).toBe('EUR');

      const renamed = await helpers.updateTransactionTemplate({
        id: created.id,
        payload: { name: 'Groceries renamed' },
        raw: true,
      });
      expect(renamed.originalCurrencyCode).toBe('EUR');

      const cleared = await helpers.updateTransactionTemplate({
        id: created.id,
        payload: { originalCurrencyCode: null },
        raw: true,
      });
      expect(cleared.originalCurrencyCode).toBeNull();

      const [fetched] = await helpers.getTransactionTemplates({ raw: true });
      expect(fetched!.originalCurrencyCode).toBeNull();

      const invalid = await helpers.createTransactionTemplate({
        payload: buildPayload({ name: 'Invalid', originalCurrencyCode: 'ZZZ' }),
      });
      expect(invalid.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('rejects an amount without an account, a negative amount, a bank-connected account and an archived account with 422', async () => {
      const account = await helpers.createAccount({ raw: true });
      const bankAccount = await helpers.createAccount({
        payload: { ...helpers.buildAccountPayload(), type: ACCOUNT_TYPES.monobank },
        raw: true,
      });
      const archivedAccount = await helpers.createAccount({ raw: true });
      await helpers.updateAccount({
        id: archivedAccount.id,
        payload: { status: ACCOUNT_STATUSES.archived },
        raw: true,
      });

      const amountWithoutAccountRes = await helpers.createTransactionTemplate({
        payload: buildPayload({ amount: 10 }),
      });
      const negativeAmountRes = await helpers.createTransactionTemplate({
        payload: buildPayload({ amount: -10, accountId: account.id }),
      });
      const bankAccountRes = await helpers.createTransactionTemplate({
        payload: buildPayload({ accountId: bankAccount.id }),
      });
      const archivedAccountRes = await helpers.createTransactionTemplate({
        payload: buildPayload({ accountId: archivedAccount.id }),
      });

      expect(amountWithoutAccountRes.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(negativeAmountRes.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(bankAccountRes.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(archivedAccountRes.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await helpers.getTransactionTemplates({ raw: true })).toEqual([]);
    });

    it('create rejects every foreign reference with 404', async () => {
      const other = await helpers.provisionSecondUserWithBaseCurrency();
      const foreign = await helpers.asUser({
        cookies: other.cookies,
        fn: async () => ({
          account: await helpers.createAccount({ raw: true }),
          category: await helpers.addCustomCategory({ name: 'Foreign', color: '#AABBCC', raw: true }),
          payee: await helpers.createPayee({ payload: helpers.buildPayeePayload({ name: 'Foreign' }), raw: true }),
          tag: await helpers.createTag({ payload: { name: 'foreign', color: '#333333' }, raw: true }),
        }),
      });

      const accountRes = await helpers.createTransactionTemplate({
        payload: buildPayload({ accountId: foreign.account.id }),
      });
      const categoryRes = await helpers.createTransactionTemplate({
        payload: buildPayload({ categoryId: foreign.category.id }),
      });
      const payeeRes = await helpers.createTransactionTemplate({
        payload: buildPayload({ payeeId: foreign.payee.id }),
      });
      const tagRes = await helpers.createTransactionTemplate({
        payload: buildPayload({ tagIds: [foreign.tag.id] }),
      });

      expect(accountRes.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(categoryRes.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(payeeRes.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(tagRes.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(await helpers.getTransactionTemplates({ raw: true })).toEqual([]);
    }, 30000);
  });

  describe('PUT /transaction-templates/:id', () => {
    it('keeps untouched fields on a partial update', async () => {
      const account = await helpers.createAccount({ raw: true });
      const tag = await helpers.createTag({ payload: { name: 'weekly', color: '#111111' }, raw: true });
      const created = await helpers.createTransactionTemplate({
        payload: buildPayload({
          amount: 12.34,
          accountId: account.id,
          paymentType: PAYMENT_TYPES.cash,
          note: 'keep me',
          tagIds: [tag.id],
        }),
        raw: true,
      });

      const updated = await helpers.updateTransactionTemplate({
        id: created.id,
        payload: { name: 'Groceries renamed' },
        raw: true,
      });

      expect(updated.name).toBe('Groceries renamed');
      expect(updated.amount).toBe(12.34);
      expect(updated.accountId).toBe(account.id);
      expect(updated.paymentType).toBe(PAYMENT_TYPES.cash);
      expect(updated.note).toBe('keep me');
      expect(updated.tagIds).toEqual([tag.id]);
    });

    it('replaces the tag set when tagIds are provided', async () => {
      const tagA = await helpers.createTag({ payload: { name: 'a', color: '#111111' }, raw: true });
      const tagB = await helpers.createTag({ payload: { name: 'b', color: '#222222' }, raw: true });
      const created = await helpers.createTransactionTemplate({
        payload: buildPayload({ tagIds: [tagA.id] }),
        raw: true,
      });

      const updated = await helpers.updateTransactionTemplate({
        id: created.id,
        payload: { tagIds: [tagB.id] },
        raw: true,
      });

      expect(updated.tagIds).toEqual([tagB.id]);
    });

    it('clears every tag when tagIds is empty', async () => {
      const tag = await helpers.createTag({ payload: { name: 'weekly', color: '#111111' }, raw: true });
      const created = await helpers.createTransactionTemplate({
        payload: buildPayload({ tagIds: [tag.id] }),
        raw: true,
      });

      const updated = await helpers.updateTransactionTemplate({
        id: created.id,
        payload: { tagIds: [] },
        raw: true,
      });

      expect(updated.tagIds).toEqual([]);

      const [template] = await helpers.getTransactionTemplates({ raw: true });
      expect(template!.tagIds).toEqual([]);
    });

    it('rejects clearing the account while an amount is still pinned', async () => {
      const account = await helpers.createAccount({ raw: true });
      const created = await helpers.createTransactionTemplate({
        payload: buildPayload({ amount: 10, accountId: account.id }),
        raw: true,
      });

      const response = await helpers.updateTransactionTemplate({
        id: created.id,
        payload: { accountId: null },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('returns 404 for an unknown template', async () => {
      const response = await helpers.updateTransactionTemplate({
        id: '00000000-0000-0000-0000-000000000000',
        payload: { name: 'nope' },
      });

      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('flips transactionType between income and expense', async () => {
      const created = await helpers.createTransactionTemplate({ payload: buildPayload(), raw: true });
      expect(created.transactionType).toBe(TRANSACTION_TYPES.expense);

      const updated = await helpers.updateTransactionTemplate({
        id: created.id,
        payload: { transactionType: TRANSACTION_TYPES.income },
        raw: true,
      });
      expect(updated.transactionType).toBe(TRANSACTION_TYPES.income);

      const [afterIncome] = await helpers.getTransactionTemplates({ raw: true });
      expect(afterIncome!.transactionType).toBe(TRANSACTION_TYPES.income);

      await helpers.updateTransactionTemplate({
        id: created.id,
        payload: { transactionType: TRANSACTION_TYPES.expense },
        raw: true,
      });

      const [afterExpense] = await helpers.getTransactionTemplates({ raw: true });
      expect(afterExpense!.transactionType).toBe(TRANSACTION_TYPES.expense);
    });

    it('clears the account and the amount together', async () => {
      const account = await helpers.createAccount({ raw: true });
      const created = await helpers.createTransactionTemplate({
        payload: buildPayload({ amount: 10, accountId: account.id }),
        raw: true,
      });

      const updated = await helpers.updateTransactionTemplate({
        id: created.id,
        payload: { accountId: null, amount: null },
        raw: true,
      });

      expect(updated.accountId).toBeNull();
      expect(updated.amount).toBeNull();
    });
  });

  describe('DELETE /transaction-templates/:id', () => {
    it('deletes the template', async () => {
      const created = await helpers.createTransactionTemplate({ payload: buildPayload(), raw: true });

      const result = await helpers.deleteTransactionTemplate({ id: created.id, raw: true });

      expect(result).toEqual({ success: true });
      expect(await helpers.getTransactionTemplates({ raw: true })).toEqual([]);
    });

    it('returns 404 for an unknown template', async () => {
      const response = await helpers.deleteTransactionTemplate({ id: '00000000-0000-0000-0000-000000000000' });

      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('releases its tag links, so the tag can be deleted afterwards', async () => {
      const tag = await helpers.createTag({ payload: { name: 'weekly', color: '#111111' }, raw: true });
      const created = await helpers.createTransactionTemplate({
        payload: buildPayload({ tagIds: [tag.id] }),
        raw: true,
      });

      const templateResponse = await helpers.deleteTransactionTemplate({ id: created.id });
      const tagResponse = await helpers.deleteTag({ id: tag.id, raw: false });

      expect(templateResponse.statusCode).toBe(200);
      expect(tagResponse.statusCode).toBe(200);
    });
  });

  it('returns 409 for a colliding name on create and on rename, but lets a template keep its own name', async () => {
    const groceries = await helpers.createTransactionTemplate({
      payload: buildPayload({ name: 'Groceries' }),
      raw: true,
    });

    const sameNameRes = await helpers.createTransactionTemplate({ payload: buildPayload({ name: 'Groceries' }) });
    const differentCaseRes = await helpers.createTransactionTemplate({ payload: buildPayload({ name: 'GROCERIES' }) });
    const whitespaceRes = await helpers.createTransactionTemplate({ payload: buildPayload({ name: '  Groceries  ' }) });

    expect(sameNameRes.statusCode).toBe(ERROR_CODES.ConflictError);
    expect(differentCaseRes.statusCode).toBe(ERROR_CODES.ConflictError);
    expect(whitespaceRes.statusCode).toBe(ERROR_CODES.ConflictError);

    const salary = await helpers.createTransactionTemplate({ payload: buildPayload({ name: 'Salary' }), raw: true });
    const renameRes = await helpers.updateTransactionTemplate({ id: salary.id, payload: { name: 'groceries' } });

    expect(renameRes.statusCode).toBe(ERROR_CODES.ConflictError);

    const updated = await helpers.updateTransactionTemplate({
      id: groceries.id,
      payload: { name: 'Groceries', note: 'same name' },
      raw: true,
    });

    expect(updated.note).toBe('same name');
  });

  it('another user can neither see nor touch my template', async () => {
    const created = await helpers.createTransactionTemplate({
      payload: buildPayload({ note: 'mine' }),
      raw: true,
    });

    const other = await helpers.provisionSecondUserWithBaseCurrency();
    const foreign = await helpers.asUser({
      cookies: other.cookies,
      fn: async () => ({
        account: await helpers.createAccount({ raw: true }),
        category: await helpers.addCustomCategory({ name: 'Foreign', color: '#AABBCC', raw: true }),
        payee: await helpers.createPayee({ payload: helpers.buildPayeePayload({ name: 'Foreign' }), raw: true }),
        tag: await helpers.createTag({ payload: { name: 'foreign', color: '#333333' }, raw: true }),
      }),
    });

    const accountRes = await helpers.updateTransactionTemplate({
      id: created.id,
      payload: { accountId: foreign.account.id },
    });
    const categoryRes = await helpers.updateTransactionTemplate({
      id: created.id,
      payload: { categoryId: foreign.category.id },
    });
    const payeeRes = await helpers.updateTransactionTemplate({
      id: created.id,
      payload: { payeeId: foreign.payee.id },
    });
    const tagRes = await helpers.updateTransactionTemplate({
      id: created.id,
      payload: { tagIds: [foreign.tag.id] },
    });

    expect(accountRes.statusCode).toBe(ERROR_CODES.NotFoundError);
    expect(categoryRes.statusCode).toBe(ERROR_CODES.NotFoundError);
    expect(payeeRes.statusCode).toBe(ERROR_CODES.NotFoundError);
    expect(tagRes.statusCode).toBe(ERROR_CODES.NotFoundError);

    const hijackRes = await helpers.asUser({
      cookies: other.cookies,
      fn: () => helpers.updateTransactionTemplate({ id: created.id, payload: { name: 'hijacked', note: 'theirs' } }),
    });
    const foreignDeleteRes = await helpers.asUser({
      cookies: other.cookies,
      fn: () => helpers.deleteTransactionTemplate({ id: created.id }),
    });

    expect(hijackRes.statusCode).toBe(ERROR_CODES.NotFoundError);
    expect(foreignDeleteRes.statusCode).toBe(ERROR_CODES.NotFoundError);

    const untouched = await helpers.getTransactionTemplates({ raw: true });
    expect(untouched.map((tpl) => ({ id: tpl.id, name: tpl.name, note: tpl.note }))).toEqual([
      { id: created.id, name: 'Groceries', note: 'mine' },
    ]);

    const foreignCreateRes = await helpers.asUser({
      cookies: other.cookies,
      fn: () => helpers.createTransactionTemplate({ payload: buildPayload({ name: 'groceries' }) }),
    });

    expect(foreignCreateRes.statusCode).toBe(201);
    expect((await helpers.getTransactionTemplates({ raw: true })).map((tpl) => tpl.name)).toEqual(['Groceries']);
  }, 30000);

  describe('reference lifecycle', () => {
    it('nulls categoryId when the category is deleted', async () => {
      const category = await helpers.addCustomCategory({ name: 'Doomed', color: '#AABBCC', raw: true });
      const created = await helpers.createTransactionTemplate({
        payload: buildPayload({ categoryId: category.id }),
        raw: true,
      });
      expect(created.categoryId).toBe(category.id);

      await helpers.deleteCustomCategory({ categoryId: category.id });

      const [template] = await helpers.getTransactionTemplates({ raw: true });
      expect(template!.categoryId).toBeNull();
    });

    it('nulls accountId and amount when the account is archived', async () => {
      const account = await helpers.createAccount({ raw: true });
      await helpers.createTransactionTemplate({
        payload: buildPayload({ amount: 25, accountId: account.id }),
        raw: true,
      });

      await helpers.updateAccount({ id: account.id, payload: { status: ACCOUNT_STATUSES.archived }, raw: true });

      const [template] = await helpers.getTransactionTemplates({ raw: true });
      expect(template!.accountId).toBeNull();
      expect(template!.amount).toBeNull();
    });

    it('nulls accountId and amount when the account is deleted', async () => {
      const account = await helpers.createAccount({ raw: true });
      await helpers.createTransactionTemplate({
        payload: buildPayload({ amount: 25, accountId: account.id }),
        raw: true,
      });

      await helpers.deleteAccount({ id: account.id, raw: true });

      const [template] = await helpers.getTransactionTemplates({ raw: true });
      expect(template!.accountId).toBeNull();
      expect(template!.amount).toBeNull();
    });

    it('nulls payeeId when the payee is deleted', async () => {
      const payee = await helpers.createPayee({ payload: helpers.buildPayeePayload({ name: 'Doomed' }), raw: true });
      const created = await helpers.createTransactionTemplate({
        payload: buildPayload({ payeeId: payee.id }),
        raw: true,
      });
      expect(created.payeeId).toBe(payee.id);

      await helpers.deletePayee({ id: payee.id, raw: true });

      const [template] = await helpers.getTransactionTemplates({ raw: true });
      expect(template!.payeeId).toBeNull();
    });

    it('does not resurrect a stranded amount when re-pinned after the account is deleted', async () => {
      const accountA = await helpers.createAccount({ raw: true });
      const created = await helpers.createTransactionTemplate({
        payload: buildPayload({ amount: 25, accountId: accountA.id }),
        raw: true,
      });

      await helpers.deleteAccount({ id: accountA.id, raw: true });

      const accountB = await helpers.createAccount({ raw: true });
      const response = await helpers.updateTransactionTemplate({
        id: created.id,
        payload: { accountId: accountB.id },
      });

      expect(response.statusCode).toBe(200);

      const updated = response.body.response;
      expect(updated.accountId).toBe(accountB.id);
      expect(updated.amount).toBeNull();

      const [template] = await helpers.getTransactionTemplates({ raw: true });
      expect(template!.amount).toBeNull();
    });

    it('drops a deleted tag from tagIds', async () => {
      const tagA = await helpers.createTag({ payload: { name: 'a', color: '#111111' }, raw: true });
      const tagB = await helpers.createTag({ payload: { name: 'b', color: '#222222' }, raw: true });
      await helpers.createTransactionTemplate({
        payload: buildPayload({ tagIds: [tagA.id, tagB.id] }),
        raw: true,
      });

      await helpers.deleteTag({ id: tagA.id });

      const [template] = await helpers.getTransactionTemplates({ raw: true });
      expect(template!.tagIds).toEqual([tagB.id]);
    });

    it('follows a merged payee to the merge target', async () => {
      const source = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Corner Shop' }),
        raw: true,
      });
      const target = await helpers.createPayee({ payload: helpers.buildPayeePayload({ name: 'Lidl' }), raw: true });
      await helpers.createTransactionTemplate({ payload: buildPayload({ payeeId: source.id }), raw: true });

      await helpers.mergePayees({ sourceId: source.id, targetId: target.id, raw: true });

      const [template] = await helpers.getTransactionTemplates({ raw: true });
      expect(template!.payeeId).toBe(target.id);
    });

    it('follows a deleted category to its replacement', async () => {
      const doomed = await helpers.addCustomCategory({ name: 'Doomed', color: '#AABBCC', raw: true });
      const replacement = await helpers.addCustomCategory({ name: 'Successor', color: '#CCBBAA', raw: true });
      await helpers.createTransactionTemplate({ payload: buildPayload({ categoryId: doomed.id }), raw: true });

      await helpers.deleteCustomCategory({ categoryId: doomed.id, replaceWithCategoryId: replacement.id });

      const [template] = await helpers.getTransactionTemplates({ raw: true });
      expect(template!.categoryId).toBe(replacement.id);
    });
  });
});
