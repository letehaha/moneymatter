import { OUT_OF_WALLET_ACCOUNT_MOCK, VERBOSE_PAYMENT_TYPES } from '@/common/const';
import type { FormattedCategory } from '@/common/types';
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  type AccountModel,
  type CurrencyModel,
  PAYMENT_TYPES,
  type RecordId,
  type ResourceShareInfo,
  TRANSACTION_TYPES,
  type TransactionTemplateModel,
} from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { FORM_TYPES, type UI_FORM_STRUCT } from '../types';
import { type TemplateFormSources, templateToForm } from './template-to-form';

const ACCOUNT_ID = '00000000-0000-0000-0000-0000000000a1' as RecordId;
const OTHER_ACCOUNT_ID = '00000000-0000-0000-0000-0000000000a2' as RecordId;
const ARCHIVED_ACCOUNT_ID = '00000000-0000-0000-0000-0000000000a9' as RecordId;
const CATEGORY_ID = '00000000-0000-0000-0000-0000000000c1' as RecordId;
const MISSING_CATEGORY_ID = '00000000-0000-0000-0000-0000000000c9' as RecordId;
const PAYEE_ID = '00000000-0000-0000-0000-0000000000p1' as RecordId;

const createAccount = (overrides: Partial<AccountModel> = {}): AccountModel =>
  ({
    id: ACCOUNT_ID,
    name: 'Checking',
    type: ACCOUNT_TYPES.system,
    status: ACCOUNT_STATUSES.active,
    currencyCode: 'USD',
    ...overrides,
  }) as AccountModel;

const createCategory = (overrides: Partial<FormattedCategory> = {}): FormattedCategory =>
  ({
    id: CATEGORY_ID,
    name: 'Groceries',
    subCategories: [],
    ...overrides,
  }) as FormattedCategory;

const createTemplate = (overrides: Partial<TransactionTemplateModel> = {}): TransactionTemplateModel =>
  ({
    id: '00000000-0000-0000-0000-0000000000t1' as RecordId,
    userId: 1,
    name: 'Morning coffee',
    transactionType: TRANSACTION_TYPES.expense,
    amount: 4.5,
    accountId: ACCOUNT_ID,
    categoryId: CATEGORY_ID,
    payeeId: PAYEE_ID,
    paymentType: PAYMENT_TYPES.cash,
    note: 'Latte',
    tagIds: [],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }) as TransactionTemplateModel;

const createCurrentForm = (overrides: Partial<UI_FORM_STRUCT> = {}): UI_FORM_STRUCT => ({
  amount: 999,
  account: createAccount({ id: OTHER_ACCOUNT_ID, name: 'Savings' }),
  toAccount: null,
  toPortfolio: null,
  targetAmount: null,
  category: createCategory({ id: MISSING_CATEGORY_ID, name: 'Seeded' }),
  time: new Date('2020-06-01T10:00:00Z'),
  paymentType: VERBOSE_PAYMENT_TYPES.find((item) => item.value === PAYMENT_TYPES.creditCard) ?? null,
  note: 'typed by hand',
  type: FORM_TYPES.expense,
  refundedByTxs: undefined,
  refundsTx: undefined,
  tagIds: [],
  payeeId: null,
  categoryUserTouched: false,
  isPlanned: false,
  originalAmount: null,
  originalCurrency: null,
  ...overrides,
});

const createSources = (overrides: Partial<TemplateFormSources> = {}): TemplateFormSources => ({
  sourceAccounts: [createAccount(), createAccount({ id: OTHER_ACCOUNT_ID, name: 'Savings' })],
  categoriesMap: { [CATEGORY_ID]: createCategory() },
  knownTagIds: new Set<string>(),
  currencies: [],
  ...overrides,
});

describe('templateToForm', () => {
  it('resolves every reference of a fully populated template', () => {
    const { form, missing } = templateToForm({
      template: createTemplate(),
      current: createCurrentForm(),
      sources: createSources(),
    });

    expect(missing).toEqual([]);
    expect(form.type).toBe(FORM_TYPES.expense);
    expect(form.account?.id).toBe(ACCOUNT_ID);
    expect(form.amount).toBe(4.5);
    expect(form.category?.id).toBe(CATEGORY_ID);
    expect(form.categoryUserTouched).toBe(true);
    expect(form.payeeId).toBe(PAYEE_ID);
    expect(form.paymentType?.value).toBe(PAYMENT_TYPES.cash);
    expect(form.note).toBe('Latte');
    expect(form.isPlanned).toBe(false);
    expect(form.toAccount).toBeNull();
    expect(form.toPortfolio).toBeNull();
    expect(form.targetAmount).toBeNull();
    expect(form.splits).toEqual([]);
    expect(form.originalAmount).toBeNull();
    expect(form.originalCurrency).toBeNull();
  });

  it('preselects the original currency and leaves its amount empty', () => {
    const gel = { code: 'GEL' } as CurrencyModel;
    const { form } = templateToForm({
      template: createTemplate({ originalCurrencyCode: 'GEL' }),
      current: createCurrentForm(),
      sources: createSources({ currencies: [gel] }),
    });

    expect(form.originalCurrency).toBe(gel);
    expect(form.originalAmount).toBeNull();
  });

  it('leaves the original currency empty when its code is not in the currency list', () => {
    const { form } = templateToForm({
      template: createTemplate({ originalCurrencyCode: 'GEL' }),
      current: createCurrentForm(),
      sources: createSources({ currencies: [{ code: 'USD' } as CurrencyModel] }),
    });

    expect(form.originalCurrency).toBeNull();
  });

  it('maps an income template to the income form type', () => {
    const { form } = templateToForm({
      template: createTemplate({ transactionType: TRANSACTION_TYPES.income }),
      current: createCurrentForm(),
      sources: createSources(),
    });

    expect(form.type).toBe(FORM_TYPES.income);
  });

  it('reports a stale category and leaves the form category empty', () => {
    const { form, missing } = templateToForm({
      template: createTemplate({ categoryId: MISSING_CATEGORY_ID }),
      current: createCurrentForm(),
      sources: createSources(),
    });

    expect(form.category).toBeNull();
    expect(form.categoryUserTouched).toBe(false);
    expect(missing).toEqual(['category']);
  });

  it('reports nothing missing for a template that pins no category', () => {
    const { form, missing } = templateToForm({
      template: createTemplate({ categoryId: null }),
      current: createCurrentForm(),
      sources: createSources(),
    });

    expect(form.category).toBeNull();
    expect(missing).toEqual([]);
  });

  it('keeps the currently selected account when the template pins none', () => {
    const { form, missing } = templateToForm({
      template: createTemplate({ accountId: null, amount: null }),
      current: createCurrentForm(),
      sources: createSources(),
    });

    expect(form.account?.id).toBe(OTHER_ACCOUNT_ID);
    expect(form.amount).toBeNull();
    expect(missing).toEqual([]);
  });

  it('drops the out-of-wallet placeholder instead of keeping it as the account', () => {
    const { form } = templateToForm({
      template: createTemplate({ accountId: null, amount: null }),
      current: createCurrentForm({ account: OUT_OF_WALLET_ACCOUNT_MOCK }),
      sources: createSources(),
    });

    expect(form.account).toBeNull();
  });

  it('drops a bank-connected current account: the form only offers those under "Planned"', () => {
    const { form } = templateToForm({
      template: createTemplate({ accountId: null, amount: null }),
      current: createCurrentForm({ account: createAccount({ type: ACCOUNT_TYPES.monobank }) }),
      sources: createSources(),
    });

    expect(form.account).toBeNull();
  });

  it('drops an archived current account', () => {
    const { form } = templateToForm({
      template: createTemplate({ accountId: null, amount: null }),
      current: createCurrentForm({ account: createAccount({ status: ACCOUNT_STATUSES.archived }) }),
      sources: createSources(),
    });

    expect(form.account).toBeNull();
  });

  it('drops a current account shared with the caller', () => {
    const { form } = templateToForm({
      template: createTemplate({ accountId: null, amount: null }),
      current: createCurrentForm({ account: createAccount({ share: { isOwner: false } as ResourceShareInfo }) }),
      sources: createSources(),
    });

    expect(form.account).toBeNull();
  });

  it('keeps the current account but drops the amount when the pinned account is gone', () => {
    const { form, missing } = templateToForm({
      template: createTemplate({ accountId: ARCHIVED_ACCOUNT_ID, amount: 4.5 }),
      current: createCurrentForm(),
      sources: createSources(),
    });

    expect(form.account?.id).toBe(OTHER_ACCOUNT_ID);
    expect(form.amount).toBeNull();
    expect(missing).toContain('account');
  });

  it('falls back to the current payment type when the template pins none', () => {
    const { form } = templateToForm({
      template: createTemplate({ paymentType: null }),
      current: createCurrentForm(),
      sources: createSources(),
    });

    expect(form.paymentType?.value).toBe(PAYMENT_TYPES.creditCard);
    expect(form.paymentTypeUserTouched).toBe(false);
  });

  it('marks the payment type as chosen when the template pins one', () => {
    const { form } = templateToForm({
      template: createTemplate(),
      current: createCurrentForm(),
      sources: createSources(),
    });

    expect(form.paymentTypeUserTouched).toBe(true);
  });

  it('keeps a payment type the user already chose when the template pins none', () => {
    const { form } = templateToForm({
      template: createTemplate({ paymentType: null }),
      current: createCurrentForm({ paymentTypeUserTouched: true }),
      sources: createSources(),
    });

    expect(form.paymentTypeUserTouched).toBe(true);
  });

  it('keeps only the tags that still exist', () => {
    const { form } = templateToForm({
      template: createTemplate({ tagIds: ['tag-a', 'tag-gone', 'tag-b'] as RecordId[] }),
      current: createCurrentForm(),
      sources: createSources({ knownTagIds: new Set(['tag-a', 'tag-b', 'tag-unused']) }),
    });

    expect(form.tagIds).toEqual(['tag-a', 'tag-b']);
  });

  it('clears transfer-only fields when applied onto a transfer form', () => {
    const { form } = templateToForm({
      template: createTemplate(),
      current: createCurrentForm({
        type: FORM_TYPES.transfer,
        toAccount: createAccount({ id: OTHER_ACCOUNT_ID }),
        targetAmount: 120,
      }),
      sources: createSources(),
    });

    expect(form.type).toBe(FORM_TYPES.expense);
    expect(form.toAccount).toBeNull();
    expect(form.targetAmount).toBeNull();
  });

  it('represents an empty note the way the form seed does', () => {
    const { form } = templateToForm({
      template: createTemplate({ note: null }),
      current: createCurrentForm(),
      sources: createSources(),
    });

    expect(form.note).toBeUndefined();
  });

  it('keeps the planned flag of the current form', () => {
    const { form } = templateToForm({
      template: createTemplate(),
      current: createCurrentForm({ isPlanned: true }),
      sources: createSources(),
    });

    expect(form.isPlanned).toBe(true);
  });

  it('does not mutate the current form', () => {
    const current = createCurrentForm();
    const snapshot = JSON.stringify(current);

    templateToForm({ template: createTemplate(), current, sources: createSources() });

    expect(JSON.stringify(current)).toBe(snapshot);
  });

  it('stamps a fresh time instead of reusing the current one', () => {
    const current = createCurrentForm();

    const { form } = templateToForm({ template: createTemplate(), current, sources: createSources() });

    expect(form.time).not.toBe(current.time);
    expect(form.time.getTime()).toBeGreaterThan(current.time.getTime());
  });
});
