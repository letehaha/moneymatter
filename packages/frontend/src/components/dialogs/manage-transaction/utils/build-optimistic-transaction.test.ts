import { VUE_QUERY_CACHE_KEYS, VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { PAYMENT_TYPES, type TransactionModel } from '@bt/shared/types';
import { QueryClient } from '@tanstack/vue-query';
import { SYSTEM_CURRENCIES } from '@tests/mocks';
import { beforeEach, describe, expect, it } from 'vitest';

import { FORM_TYPES, type UI_FORM_STRUCT } from '../types';
import { applyOptimisticTransactionUpdate, buildOptimisticTransaction } from './build-optimistic-transaction';

const buildTransaction = (overrides: Record<string, unknown> = {}): TransactionModel =>
  ({
    id: 'tx-1',
    amount: 100,
    transactionType: 'expense',
    note: 'original',
    ...overrides,
  }) as unknown as TransactionModel;

const JPY = SYSTEM_CURRENCIES.find((item) => item.code === 'JPY')!;

describe('buildOptimisticTransaction', () => {
  const buildForm = (overrides: Partial<UI_FORM_STRUCT> = {}): UI_FORM_STRUCT =>
    ({
      amount: 250,
      time: new Date('2030-01-15T10:00:00.000Z'),
      type: FORM_TYPES.expense,
      paymentType: { value: PAYMENT_TYPES.cash, label: 'Cash' },
      note: 'updated',
      ...overrides,
    }) as UI_FORM_STRUCT;

  it('leaves amount and time untouched for a synced transaction', () => {
    const transaction = buildTransaction({ time: new Date('2024-01-01T00:00:00.000Z') });

    const result = buildOptimisticTransaction({ form: buildForm(), transaction, isRecordBankLocked: true });

    expect(result.amount).toBe(100);
    expect(result.time).toEqual(new Date('2024-01-01T00:00:00.000Z'));
  });

  it('applies amount and time for a planned transaction on a synced account', () => {
    const transaction = buildTransaction({ time: new Date('2024-01-01T00:00:00.000Z'), isPlanned: true });

    const result = buildOptimisticTransaction({
      form: buildForm({ isPlanned: true }),
      transaction,
      isRecordBankLocked: true,
    });

    expect(result.amount).toBe(250);
    expect(result.time).toEqual(new Date('2030-01-15T10:00:00.000Z'));
    expect(result.isPlanned).toBe(true);
  });

  it('clears isPlanned when the form flag is unchecked', () => {
    const transaction = buildTransaction({ isPlanned: true });

    const result = buildOptimisticTransaction({
      form: buildForm({ isPlanned: false }),
      transaction,
      isRecordBankLocked: false,
    });

    expect(result.isPlanned).toBe(false);
  });

  it('applies excludeFromStats from the form', () => {
    const result = buildOptimisticTransaction({
      form: buildForm({ excludeFromStats: true }),
      transaction: buildTransaction({ excludeFromStats: false }),
      isRecordBankLocked: false,
    });

    expect(result.excludeFromStats).toBe(true);
  });

  it('clears excludeFromStats when the form flag is unchecked', () => {
    const result = buildOptimisticTransaction({
      form: buildForm({ excludeFromStats: false }),
      transaction: buildTransaction({ excludeFromStats: true }),
      isRecordBankLocked: false,
    });

    expect(result.excludeFromStats).toBe(false);
  });

  it('carries a complete original-currency pair onto the row', () => {
    const transaction = buildTransaction({ originalAmount: null, originalCurrencyCode: null });

    const result = buildOptimisticTransaction({
      form: buildForm({ originalAmount: 1500, originalCurrency: JPY }),
      transaction,
      isRecordBankLocked: false,
    });

    expect(result.originalAmount).toBe(1500);
    expect(result.originalCurrencyCode).toBe('JPY');
  });

  it('clears the pair when both form fields are empty', () => {
    const transaction = buildTransaction({ originalAmount: 1500, originalCurrencyCode: 'JPY' });

    const result = buildOptimisticTransaction({
      form: buildForm({ originalAmount: null, originalCurrency: null }),
      transaction,
      isRecordBankLocked: false,
    });

    expect(result.originalAmount).toBeNull();
    expect(result.originalCurrencyCode).toBeNull();
  });

  it('keeps the stored pair when the transaction becomes a transfer', () => {
    const transaction = buildTransaction({ originalAmount: 1500, originalCurrencyCode: 'JPY' });

    const result = buildOptimisticTransaction({
      form: buildForm({ type: FORM_TYPES.transfer, originalAmount: 9999, originalCurrency: JPY }),
      transaction,
      isRecordBankLocked: false,
    });

    expect(result.originalAmount).toBe(1500);
    expect(result.originalCurrencyCode).toBe('JPY');
  });

  it('keeps stored detail fields when untouched, clears them on blank, trims otherwise', () => {
    const transaction = buildTransaction({
      externalUrl: 'https://a.example/1',
      externalReference: 'A-1',
      location: { latitude: 1, longitude: 2 },
    });

    const untouched = buildOptimisticTransaction({ form: buildForm(), transaction, isRecordBankLocked: false });
    expect(untouched.externalUrl).toBe('https://a.example/1');
    expect(untouched.externalReference).toBe('A-1');
    expect(untouched.location).toEqual({ latitude: 1, longitude: 2 });

    const edited = buildOptimisticTransaction({
      form: buildForm({ externalUrl: '  ', externalReference: ' B-2 ', latitude: null, longitude: null }),
      transaction,
      isRecordBankLocked: false,
    });
    expect(edited.externalUrl).toBeNull();
    expect(edited.externalReference).toBe('B-2');
    expect(edited.location).toBeNull();
  });
});

describe('applyOptimisticTransactionUpdate', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  it('updates infinite queries whose pages are transaction arrays', () => {
    const queryKey = [...VUE_QUERY_CACHE_KEYS.recordsPageTransactionList];
    queryClient.setQueryData(queryKey, {
      pages: [[buildTransaction(), buildTransaction({ id: 'tx-2' })]],
      pageParams: [0],
    });

    applyOptimisticTransactionUpdate({
      queryClient,
      transactionId: 'tx-1',
      updatedTransaction: buildTransaction({ note: 'updated' }),
    });

    const data = queryClient.getQueryData<{ pages: TransactionModel[][] }>(queryKey);
    expect(data!.pages[0]![0]!.note).toBe('updated');
    expect(data!.pages[0]![1]!.note).toBe('original');
  });

  it('leaves infinite queries whose pages are objects untouched', () => {
    const queryKey = [...VUE_QUERY_CACHE_KEYS.aiCategorizationHistory];
    const page = { items: [{ categorizedAt: '2026-08-03T00:00:00.000Z', transactionsCount: 5 }], totalCount: 1 };
    queryClient.setQueryData(queryKey, { pages: [page], pageParams: [0] });

    expect(() =>
      applyOptimisticTransactionUpdate({
        queryClient,
        transactionId: 'tx-1',
        updatedTransaction: buildTransaction({ note: 'updated' }),
      }),
    ).not.toThrow();

    expect(queryClient.getQueryData(queryKey)).toEqual({ pages: [page], pageParams: [0] });
  });

  it('updates transactions nested in `items` pages', () => {
    const queryKey = [...VUE_QUERY_CACHE_KEYS.aiCategorizationCandidates];
    queryClient.setQueryData(queryKey, {
      pages: [{ items: [buildTransaction(), buildTransaction({ id: 'tx-2' })], totalCount: 2 }],
      pageParams: [0],
    });

    applyOptimisticTransactionUpdate({
      queryClient,
      transactionId: 'tx-1',
      updatedTransaction: buildTransaction({ note: 'updated' }),
    });

    const data = queryClient.getQueryData<{ pages: { items: TransactionModel[]; totalCount: number }[] }>(queryKey);
    expect(data!.pages[0]!.items[0]!.note).toBe('updated');
    expect(data!.pages[0]!.items[1]!.note).toBe('original');
    expect(data!.pages[0]!.totalCount).toBe(2);
  });

  it('ignores non-transaction caches sharing the transactionChange prefix', () => {
    const queryKey = [VUE_QUERY_GLOBAL_PREFIXES.transactionChange, 'some-widget'];
    queryClient.setQueryData(queryKey, { total: 42 });

    expect(() =>
      applyOptimisticTransactionUpdate({
        queryClient,
        transactionId: 'tx-1',
        updatedTransaction: buildTransaction({ note: 'updated' }),
      }),
    ).not.toThrow();

    expect(queryClient.getQueryData(queryKey)).toEqual({ total: 42 });
  });
});
