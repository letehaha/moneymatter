import { VERBOSE_PAYMENT_TYPES } from '@/common/const';
import type { FormattedCategory } from '@/common/types';
import { useCurrenciesStore, useTagsStore } from '@/stores';
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  type AccountModel,
  PAYMENT_TYPES,
  type RecordId,
  TRANSACTION_TYPES,
  type TransactionModel,
  type TransactionTemplateModel,
} from '@bt/shared/types';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

import { FORM_TYPES, type UI_FORM_STRUCT } from '../types';
import type { TransferDestinationType } from './transfer-form';
import { useTransactionTemplating } from './use-transaction-templating';

vi.mock('@/lib/posthog', () => ({ trackAnalyticsEvent: vi.fn() }));

vi.mock('vue-i18n', () => ({
  // Echoes the key so an assertion reads as the key the UI renders.
  useI18n: () => ({ t: (key: string, named?: Record<string, unknown>) => `${key}:${JSON.stringify(named ?? {})}` }),
}));

vi.mock('@/composable/data-queries/transaction-templates', async () => {
  const { ref: vueRef } = await import('vue');
  return {
    useTransactionTemplates: () => ({
      list: vueRef([]),
      isError: vueRef(false),
      isPending: vueRef(false),
      refetch: vi.fn(),
    }),
  };
});

vi.mock('@/stores', async () => {
  const { defineStore } = await import('pinia');
  const { ref: vueRef } = await import('vue');
  return {
    useTagsStore: defineStore('tags', () => ({ tags: vueRef([]), isFetched: vueRef(false) })),
    useCurrenciesStore: defineStore('currencies', () => ({ systemCurrencies: vueRef([{ code: 'USD' }]) })),
  };
});

const ACCOUNT_ID = '00000000-0000-0000-0000-0000000000a1' as RecordId;
const CATEGORY_ID = '00000000-0000-0000-0000-0000000000c1' as RecordId;
const MISSING_CATEGORY_ID = '00000000-0000-0000-0000-0000000000c9' as RecordId;

const account: AccountModel = {
  id: ACCOUNT_ID,
  name: 'Checking',
  type: ACCOUNT_TYPES.system,
  status: ACCOUNT_STATUSES.active,
  currencyCode: 'USD',
} as AccountModel;

const category = { id: CATEGORY_ID, name: 'Groceries', subCategories: [] } as unknown as FormattedCategory;

const createTemplate = (overrides: Partial<TransactionTemplateModel> = {}): TransactionTemplateModel =>
  ({
    id: '00000000-0000-0000-0000-0000000000t1' as RecordId,
    name: 'Morning coffee',
    transactionType: TRANSACTION_TYPES.expense,
    amount: 4.5,
    accountId: ACCOUNT_ID,
    categoryId: CATEGORY_ID,
    payeeId: null,
    paymentType: PAYMENT_TYPES.cash,
    note: 'Latte',
    tagIds: [],
    ...overrides,
  }) as TransactionTemplateModel;

const createForm = (): UI_FORM_STRUCT => ({
  amount: null,
  account: null,
  toAccount: null,
  toPortfolio: null,
  targetAmount: null,
  category: null,
  time: new Date('2024-01-15T12:00:00Z'),
  paymentType: VERBOSE_PAYMENT_TYPES.find((item) => item.value === PAYMENT_TYPES.creditCard) ?? null,
  note: undefined,
  type: FORM_TYPES.expense,
  refundedByTxs: undefined,
  refundsTx: undefined,
  tagIds: [],
  payeeId: null,
  categoryUserTouched: false,
  isPlanned: false,
  originalAmount: null,
  originalCurrency: null,
});

const setup = ({
  categories = [category],
  isAccountSharedWithCaller = false,
}: { categories?: FormattedCategory[]; isAccountSharedWithCaller?: boolean } = {}) => {
  const session = {
    form: ref<UI_FORM_STRUCT>(createForm()),
    transferDestinationType: ref<TransferDestinationType>('account'),
    linkedTransaction: ref<TransactionModel | null>(null),
  };
  const isFormFieldsDisabled = ref(false);
  const submit = vi.fn();
  const focusAmountField = vi.fn();
  const focusCategoryField = vi.fn();

  const templating = useTransactionTemplating({
    session,
    isFormCreation: true,
    isReadOnly: false,
    isFormFieldsDisabled,
    isAccountsFetched: true,
    isCategoriesReady: true,
    isAccountSharedWithCaller,
    sourceAccounts: [account],
    formattedCategories: categories,
    currencyCode: 'USD',
    resetAutoTagTracking: vi.fn(),
    focusAmountField,
    focusCategoryField,
    submit,
  });

  return { session, templating, submit, isFormFieldsDisabled, focusAmountField, focusCategoryField };
};

const markTagsFetched = () => {
  useTagsStore().isFetched = true;
};

describe('useTransactionTemplating', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('writes the template into the form and announces what it filled', async () => {
    const { session, templating } = setup();

    templating.listHandlers.apply(createTemplate());

    expect(session.form.value.amount).toBe(4.5);
    expect(session.form.value.account?.id).toBe(ACCOUNT_ID);
    expect(session.form.value.category?.id).toBe(CATEGORY_ID);
    expect(templating.listProps.value.applied?.name).toBe('Morning coffee');
    expect(templating.isCategoryDeleted.value).toBe(false);

    await nextTick();
    expect(templating.announcement.value).toContain('templates.announceAppliedWithAmount');
    expect(templating.announcement.value).toContain('"count":5');
  });

  it('flags a template whose category no longer resolves', async () => {
    const { session, templating } = setup();

    templating.listHandlers.apply(createTemplate({ categoryId: MISSING_CATEGORY_ID }));

    expect(session.form.value.category).toBeNull();
    expect(templating.isCategoryDeleted.value).toBe(true);
    await nextTick();
  });

  it('re-announces when the same template is applied twice', async () => {
    const { templating } = setup();
    const template = createTemplate();

    templating.listHandlers.apply(template);
    await nextTick();
    const first = templating.announcement.value;
    expect(first).not.toBe('');

    templating.listHandlers.apply(template);
    expect(templating.announcement.value).toBe('');

    await nextTick();
    expect(templating.announcement.value).toBe(first);
  });

  it('detaches the template on clear and leaves the form as the template left it', async () => {
    const { session, templating } = setup();

    templating.listHandlers.apply(createTemplate());
    await nextTick();
    templating.listHandlers.clear();

    expect(templating.listProps.value.applied).toBeNull();
    expect(templating.announcement.value).toBe('');
    expect(session.form.value.amount).toBe(4.5);
    expect(session.form.value.note).toBe('Latte');
  });

  it('asks for confirmation before overwriting splits and applies on confirm', async () => {
    const { session, templating } = setup();
    const template = createTemplate();
    session.form.value.splits = [{ category, amount: 10 }];

    templating.listHandlers.apply(template);

    expect(session.form.value.amount).toBeNull();
    expect(templating.isApplyConfirmOpen.value).toBe(true);

    templating.confirmApply();

    expect(templating.isApplyConfirmOpen.value).toBe(false);
    expect(session.form.value.splits).toEqual([]);
    expect(session.form.value.amount).toBe(4.5);
    expect(templating.listProps.value.applied?.id).toBe(template.id);
    await nextTick();

    const applied = session.form.value;
    templating.confirmApply();

    expect(session.form.value).toBe(applied);
  });

  it('detaches only when the deleted template is the applied one', async () => {
    const { templating } = setup();
    const template = createTemplate();

    templating.listHandlers.apply(template);
    await nextTick();

    templating.editor.onDeleted({ id: '00000000-0000-0000-0000-0000000000t9' as RecordId });
    expect(templating.listProps.value.applied?.id).toBe(template.id);

    templating.editor.onDeleted({ id: template.id });
    expect(templating.listProps.value.applied).toBeNull();
  });

  it('adopts a template saved from the current form without rewriting the form', () => {
    const { session, templating } = setup();
    const template = createTemplate();
    session.form.value.amount = 77;

    templating.editor.onSaved({ template, fromCurrentForm: true });

    expect(templating.listProps.value.applied?.id).toBe(template.id);
    expect(session.form.value.amount).toBe(77);
  });

  it('never offers to save the current form on a shared account', () => {
    const shared = setup({ isAccountSharedWithCaller: true });
    shared.session.form.value.amount = 5;
    expect(shared.templating.listProps.value.canSaveCurrent).toBe(false);

    const own = setup();
    expect(own.templating.listProps.value.canSaveCurrent).toBe(false);

    own.session.form.value.amount = 5;
    expect(own.templating.listProps.value.canSaveCurrent).toBe(true);
  });

  it('hides the templates UI on a transfer form', () => {
    const { session, templating } = setup();

    session.form.value.type = FORM_TYPES.transfer;
    expect(templating.isVisible.value).toBe(false);

    session.form.value.type = FORM_TYPES.expense;
    expect(templating.isVisible.value).toBe(true);
  });

  it('disables the trigger until the tag store has loaded', () => {
    const { templating } = setup();

    expect(templating.listProps.value.disabled).toBe(true);

    markTagsFetched();

    expect(templating.listProps.value.disabled).toBe(false);
  });

  it('disables the trigger while the currency list is still empty', () => {
    const { templating } = setup();
    markTagsFetched();
    useCurrenciesStore().systemCurrencies = [];

    expect(templating.listProps.value.disabled).toBe(true);
  });

  it('disables the trigger while the category list is still empty', () => {
    const { templating } = setup({ categories: [] });
    markTagsFetched();

    expect(templating.listProps.value.disabled).toBe(true);
  });

  it('ignores Alt+T while the templates trigger is disabled', () => {
    const { templating } = setup();
    const event = new KeyboardEvent('keydown', { altKey: true, code: 'KeyT' });

    templating.onKeydown(event);

    expect(templating.listProps.value.open).toBe(false);

    markTagsFetched();
    templating.onKeydown(event);

    expect(templating.listProps.value.open).toBe(true);
  });

  it('ignores the submit shortcut while the form is busy', () => {
    const { templating, submit, isFormFieldsDisabled } = setup();
    const event = new KeyboardEvent('keydown', { key: 'Enter', metaKey: true });

    isFormFieldsDisabled.value = true;
    templating.onKeydown(event);
    expect(submit).not.toHaveBeenCalled();

    isFormFieldsDisabled.value = false;
    templating.onKeydown(event);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
