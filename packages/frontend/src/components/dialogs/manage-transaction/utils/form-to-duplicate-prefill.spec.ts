import { OUT_OF_WALLET_ACCOUNT_MOCK, VERBOSE_PAYMENT_TYPES } from '@/common/const';
import type { FormattedCategory } from '@/common/types';
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  type AccountModel,
  type CurrencyModel,
  PAYMENT_TYPES,
  type RecordId,
  TRANSACTION_TYPES,
  type TransactionModel,
} from '@bt/shared/types';
import {
  buildOutOfWalletTransaction,
  buildSystemTransferExpenseTransaction,
  buildSystemTransferOppositeTransaction,
  getUah2Account,
  getUahAccount,
} from '@tests/mocks';
import { describe, expect, it } from 'vitest';

import { prepopulateForm } from '../helpers';
import { FORM_TYPES, type UI_FORM_STRUCT } from '../types';
import { formToDuplicatePrefill } from './form-to-duplicate-prefill';

const NOW = new Date('2026-10-06T12:00:00Z');

const createAccount = (overrides: Partial<AccountModel> = {}): AccountModel =>
  ({
    id: '00000000-0000-0000-0000-0000000000a1' as RecordId,
    name: 'Checking',
    type: ACCOUNT_TYPES.system,
    status: ACCOUNT_STATUSES.active,
    currencyCode: 'USD',
    ...overrides,
  }) as AccountModel;

const createCategory = (overrides: Partial<FormattedCategory> = {}): FormattedCategory =>
  ({
    id: '00000000-0000-0000-0000-0000000000c1' as RecordId,
    name: 'Groceries',
    subCategories: [],
    ...overrides,
  }) as FormattedCategory;

const createForm = (overrides: Partial<UI_FORM_STRUCT> = {}): UI_FORM_STRUCT => ({
  amount: 42.5,
  account: createAccount(),
  toAccount: null,
  toPortfolio: null,
  targetAmount: null,
  category: createCategory(),
  time: new Date('2024-01-15T08:00:00Z'),
  paymentType: VERBOSE_PAYMENT_TYPES.find((item) => item.value === PAYMENT_TYPES.creditCard) ?? null,
  note: 'Weekly shop',
  externalUrl: 'https://example.com/receipt',
  externalReference: 'INV-1',
  latitude: 50.45,
  longitude: 30.52,
  type: FORM_TYPES.expense,
  refundedByTxs: [{ transaction: { id: 'r1' } as TransactionModel }],
  refundsTx: { transaction: { id: 'r2' } as TransactionModel },
  tagIds: ['t1', 't2'],
  payeeId: 'p1',
  categoryUserTouched: false,
  isPlanned: true,
  originalAmount: 40,
  originalCurrency: { code: 'EUR' } as CurrencyModel,
  ...overrides,
});

describe('formToDuplicatePrefill', () => {
  it('copies the on-screen values and dates the copy now', () => {
    const form = createForm();

    expect(formToDuplicatePrefill({ form, now: NOW })).toStrictEqual({
      type: FORM_TYPES.expense,
      account: form.account,
      amount: 42.5,
      time: NOW,
      category: form.category,
      payeeId: 'p1',
      tagIds: ['t1', 't2'],
      paymentType: form.paymentType,
      note: 'Weekly shop',
      externalUrl: 'https://example.com/receipt',
      externalReference: 'INV-1',
      latitude: 50.45,
      longitude: 30.52,
      originalAmount: 40,
      originalCurrency: form.originalCurrency,
      isPlanned: true,
      splits: undefined,
    });
  });

  it('leaves out refund links and transfer fields', () => {
    const prefill = formToDuplicatePrefill({
      form: createForm({ toAccount: createAccount({ id: 'a2' as RecordId }), targetAmount: 10 }),
      now: NOW,
    });

    expect(prefill).not.toHaveProperty('refundsTx');
    expect(prefill).not.toHaveProperty('refundedByTxs');
    expect(prefill).not.toHaveProperty('toAccount');
    expect(prefill).not.toHaveProperty('targetAmount');
  });

  it('strips split ids and keeps their order', () => {
    const food = createCategory({ id: 'c2' as RecordId, name: 'Food' });
    const home = createCategory({ id: 'c3' as RecordId, name: 'Home' });
    const prefill = formToDuplicatePrefill({
      form: createForm({
        splits: [
          { id: 's1', category: food, amount: 10, note: 'first' },
          { id: 's2', category: home, amount: 5, note: null },
        ],
      }),
      now: NOW,
    });

    expect(prefill.splits).toEqual([
      { category: food, amount: 10, note: 'first' },
      { category: home, amount: 5, note: null },
    ]);
  });

  it('does not share the tag array with the source form', () => {
    const form = createForm();
    const prefill = formToDuplicatePrefill({ form, now: NOW });

    prefill.tagIds!.push('t3');

    expect(form.tagIds).toEqual(['t1', 't2']);
  });

  it('normalises missing optional values', () => {
    const prefill = formToDuplicatePrefill({
      form: createForm({
        tagIds: undefined,
        payeeId: undefined,
        isPlanned: undefined,
        originalAmount: undefined,
        originalCurrency: undefined,
      }),
      now: NOW,
    });

    expect(prefill).toMatchObject({
      tagIds: [],
      payeeId: null,
      isPlanned: false,
      originalAmount: null,
      originalCurrency: null,
    });
  });
});

describe('formToDuplicatePrefill for transfers', () => {
  const source = createAccount({ id: 'a-source' as RecordId, currencyCode: 'USD' });
  const destination = createAccount({ id: 'a-destination' as RecordId, currencyCode: 'USD' });

  const createTransferForm = (overrides: Partial<UI_FORM_STRUCT> = {}) =>
    createForm({
      type: FORM_TYPES.transfer,
      account: source,
      toAccount: destination,
      amount: 100,
      targetAmount: 100,
      ...overrides,
    });

  it('copies both sides, note, tags and payment type, dated now', () => {
    const form = createTransferForm();

    expect(formToDuplicatePrefill({ form, now: NOW })).toStrictEqual({
      type: FORM_TYPES.transfer,
      account: source,
      toAccount: destination,
      amount: 100,
      targetAmount: 100,
      time: NOW,
      tagIds: ['t1', 't2'],
      paymentType: form.paymentType,
      note: 'Weekly shop',
      originalAmount: null,
      originalCurrency: null,
    });
  });

  it('does not share the tag array with the source form', () => {
    const form = createTransferForm();
    const prefill = formToDuplicatePrefill({ form, now: NOW });

    prefill.tagIds!.push('t3');

    expect(form.tagIds).toEqual(['t1', 't2']);
  });

  it('leaves out category, payee, planned flag, splits, refund links, external refs and location', () => {
    const prefill = formToDuplicatePrefill({ form: createTransferForm(), now: NOW });

    for (const key of [
      'category',
      'categoryUserTouched',
      'payeeId',
      'isPlanned',
      'splits',
      'refundsTx',
      'refundedByTxs',
      'externalUrl',
      'externalReference',
      'latitude',
      'longitude',
    ]) {
      expect(prefill).not.toHaveProperty(key);
    }
  });

  it('keeps the destination amount of a cross-currency transfer', () => {
    const eurDestination = createAccount({ id: 'a-eur' as RecordId, currencyCode: 'EUR' });
    const prefill = formToDuplicatePrefill({
      form: createTransferForm({ toAccount: eurDestination, amount: 100, targetAmount: 92.3 }),
      now: NOW,
    });

    expect(prefill).toMatchObject({ account: source, toAccount: eurDestination, amount: 100, targetAmount: 92.3 });
  });

  it('keeps the out-of-wallet placeholder as the destination of an outgoing transfer', () => {
    const prefill = formToDuplicatePrefill({
      form: createTransferForm({ toAccount: OUT_OF_WALLET_ACCOUNT_MOCK, targetAmount: undefined }),
      now: NOW,
    });

    expect(prefill).toMatchObject({
      account: source,
      toAccount: OUT_OF_WALLET_ACCOUNT_MOCK,
      amount: 100,
      targetAmount: null,
    });
  });

  it('keeps the out-of-wallet placeholder as the source of an incoming transfer', () => {
    const prefill = formToDuplicatePrefill({
      form: createTransferForm({
        account: OUT_OF_WALLET_ACCOUNT_MOCK,
        amount: undefined as unknown as null,
        targetAmount: 75,
      }),
      now: NOW,
    });

    expect(prefill).toMatchObject({
      account: OUT_OF_WALLET_ACCOUNT_MOCK,
      toAccount: destination,
      amount: null,
      targetAmount: 75,
    });
  });

  it('copies source to destination whichever leg opened the edit dialog', () => {
    const expenseAccount = getUahAccount() as AccountModel;
    const incomeAccount = getUah2Account() as AccountModel;
    const accounts = { [expenseAccount.id]: expenseAccount, [incomeAccount.id]: incomeAccount };
    const expenseLeg = buildSystemTransferExpenseTransaction({ accountId: expenseAccount.id, amount: 300 });
    const incomeLeg = buildSystemTransferOppositeTransaction({
      accountId: incomeAccount.id,
      amount: 300,
      transferId: expenseLeg.transferId,
    });

    const prefillFrom = ({ transaction, oppositeTransaction }: Record<string, TransactionModel>) =>
      formToDuplicatePrefill({
        form: prepopulateForm({
          transaction,
          oppositeTransaction,
          accounts,
          categories: {},
          formattedCategories: [],
          systemCurrencies: [],
        })!,
        now: NOW,
      });

    const expected = { account: expenseAccount, toAccount: incomeAccount, amount: 300, targetAmount: 300 };
    expect(prefillFrom({ transaction: expenseLeg, oppositeTransaction: incomeLeg })).toMatchObject(expected);
    expect(prefillFrom({ transaction: incomeLeg, oppositeTransaction: expenseLeg })).toMatchObject(expected);
  });

  describe('round-trip from an out-of-wallet transaction', () => {
    const account = getUahAccount() as AccountModel;
    const prefillFrom = ({ transaction }: { transaction: TransactionModel }) =>
      formToDuplicatePrefill({
        form: prepopulateForm({
          transaction,
          oppositeTransaction: undefined,
          accounts: { [account.id]: account },
          categories: {},
          formattedCategories: [],
          systemCurrencies: [],
        })!,
        now: NOW,
      });

    it('keeps an outgoing transfer going out of wallet', () => {
      const transaction = { ...buildOutOfWalletTransaction(), accountId: account.id, amount: 300 };

      expect(prefillFrom({ transaction })).toMatchObject({
        type: FORM_TYPES.transfer,
        account,
        toAccount: OUT_OF_WALLET_ACCOUNT_MOCK,
        amount: 300,
        targetAmount: null,
      });
    });

    it('keeps an incoming transfer coming from out of wallet', () => {
      const transaction = {
        ...buildOutOfWalletTransaction(),
        transactionType: TRANSACTION_TYPES.income,
        accountId: account.id,
        amount: 300,
      };

      expect(prefillFrom({ transaction })).toMatchObject({
        type: FORM_TYPES.transfer,
        account: OUT_OF_WALLET_ACCOUNT_MOCK,
        toAccount: account,
        amount: null,
        targetAmount: 300,
      });
    });
  });
});
