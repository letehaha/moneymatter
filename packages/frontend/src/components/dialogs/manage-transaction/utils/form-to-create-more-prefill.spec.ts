import { OUT_OF_WALLET_ACCOUNT_MOCK, VERBOSE_PAYMENT_TYPES } from '@/common/const';
import type { FormattedCategory } from '@/common/types';
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  type AccountModel,
  PAYMENT_TYPES,
  type RecordId,
  type TransactionModel,
} from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { FORM_TYPES, type UI_FORM_STRUCT } from '../types';
import { formToCreateMorePrefill } from './form-to-create-more-prefill';

const NOW = new Date('2026-10-06T12:00:00Z');
const PAST = new Date('2026-10-01T08:00:00Z');
const FUTURE = new Date('2026-10-20T08:00:00Z');

const createAccount = (overrides: Partial<AccountModel> = {}): AccountModel =>
  ({
    id: '00000000-0000-0000-0000-0000000000a1' as RecordId,
    name: 'Checking',
    type: ACCOUNT_TYPES.system,
    status: ACCOUNT_STATUSES.active,
    currencyCode: 'USD',
    ...overrides,
  }) as AccountModel;

const createForm = (overrides: Partial<UI_FORM_STRUCT> = {}): UI_FORM_STRUCT => ({
  amount: 42.5,
  account: createAccount(),
  toAccount: null,
  toPortfolio: null,
  targetAmount: 40,
  category: { id: 'c1', name: 'Groceries', subCategories: [] } as unknown as FormattedCategory,
  time: PAST,
  paymentType: VERBOSE_PAYMENT_TYPES.find((item) => item.value === PAYMENT_TYPES.creditCard) ?? null,
  note: 'Weekly shop',
  externalUrl: 'https://example.com/receipt',
  externalReference: 'INV-1',
  latitude: 50.45,
  longitude: 30.52,
  type: FORM_TYPES.expense,
  refundedByTxs: undefined,
  refundsTx: { transaction: { id: 'r1' } as TransactionModel },
  splits: [{ category: null, amount: 10 }],
  tagIds: ['t1'],
  payeeId: 'p1',
  categoryUserTouched: true,
  isPlanned: false,
  originalAmount: 40,
  originalCurrency: null,
  ...overrides,
});

describe('formToCreateMorePrefill', () => {
  it('keeps only type, account, date and payment type', () => {
    const form = createForm();

    expect(formToCreateMorePrefill({ form, now: NOW })).toEqual({
      type: FORM_TYPES.expense,
      account: form.account,
      toAccount: null,
      amount: null,
      time: PAST,
      paymentType: form.paymentType,
    });
  });

  it('keeps the destination account on a transfer', () => {
    const toAccount = createAccount({ id: 'a2' as RecordId, name: 'Savings' });
    const prefill = formToCreateMorePrefill({
      form: createForm({ type: FORM_TYPES.transfer, toAccount }),
      now: NOW,
    });

    expect(prefill.type).toBe(FORM_TYPES.transfer);
    expect(prefill.toAccount).toBe(toAccount);
  });

  it('drops a destination account left over from another tab', () => {
    const prefill = formToCreateMorePrefill({
      form: createForm({ toAccount: createAccount({ id: 'a2' as RecordId }) }),
      now: NOW,
    });

    expect(prefill.toAccount).toBeNull();
  });

  it('brings a future date back to now on a manual account', () => {
    const prefill = formToCreateMorePrefill({ form: createForm({ time: FUTURE, isPlanned: true }), now: NOW });

    expect(prefill.time).toBe(NOW);
  });

  it('brings a future date back to now when no account is picked', () => {
    const prefill = formToCreateMorePrefill({ form: createForm({ time: FUTURE, account: null }), now: NOW });

    expect(prefill.time).toBe(NOW);
  });

  it('keeps a date equal to now', () => {
    const time = new Date(NOW);
    const prefill = formToCreateMorePrefill({ form: createForm({ time }), now: NOW });

    expect(prefill.time).toBe(time);
  });

  it('keeps a future date on a bank-connected account, which stays planned', () => {
    const prefill = formToCreateMorePrefill({
      form: createForm({ time: FUTURE, isPlanned: true, account: createAccount({ type: ACCOUNT_TYPES.monobank }) }),
      now: NOW,
    });

    expect(prefill.time).toBe(FUTURE);
  });

  it('brings a future date back to now on a transfer from a bank-connected account', () => {
    const prefill = formToCreateMorePrefill({
      form: createForm({
        type: FORM_TYPES.transfer,
        time: FUTURE,
        account: createAccount({ type: ACCOUNT_TYPES.monobank }),
        toAccount: createAccount({ id: 'a2' as RecordId }),
      }),
      now: NOW,
    });

    expect(prefill.time).toBe(NOW);
  });

  it('brings a future date back to now on a transfer from out of wallet', () => {
    const prefill = formToCreateMorePrefill({
      form: createForm({
        type: FORM_TYPES.transfer,
        time: FUTURE,
        account: OUT_OF_WALLET_ACCOUNT_MOCK,
        toAccount: createAccount({ id: 'a2' as RecordId }),
      }),
      now: NOW,
    });

    expect(prefill.time).toBe(NOW);
  });
});
