import { getRefundsForTransaction } from '@/api/refunds';
import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES, type AccountModel, TRANSACTION_TYPES, type TransactionModel } from '@bt/shared/types';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type Ref, defineComponent, nextTick, ref } from 'vue';

import { FORM_TYPES, type UI_FORM_STRUCT } from '../types';
import { getRefundInfo } from './refund-info';

vi.mock('@/api/refunds', () => ({
  getRefundsForTransaction: vi.fn().mockResolvedValue([]),
}));

const addErrorNotification = vi.fn();

vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({ addErrorNotification }),
}));
vi.mock('@/i18n', () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock('@/composable/data-queries/currencies', () => ({
  useExchangeRates: () => ({ convert: ({ amount }: { amount: number }) => amount }),
}));

type RefundInfoResult = ReturnType<typeof getRefundInfo>;
type OriginalRefunds = RefundInfoResult['originalRefunds']['value'];

const makeTx = (id: string, transactionType: TRANSACTION_TYPES): TransactionModel =>
  ({ id, transactionType }) as unknown as TransactionModel;

const makeForm = (overrides: Partial<UI_FORM_STRUCT> = {}): UI_FORM_STRUCT =>
  ({
    type: FORM_TYPES.expense,
    refundsTx: undefined,
    refundedByTxs: undefined,
    ...overrides,
  }) as UI_FORM_STRUCT;

const setup = ({
  form,
  onRefundLinkCleared,
  initialTransaction,
}: {
  form: Ref<UI_FORM_STRUCT>;
  onRefundLinkCleared?: () => void;
  initialTransaction?: TransactionModel;
}): (() => RefundInfoResult) => {
  let result: RefundInfoResult | undefined;

  const TestComponent = defineComponent({
    setup() {
      result = getRefundInfo({ initialTransaction, form, onRefundLinkCleared });
      return {};
    },
    template: '<div />',
  });

  mount(TestComponent);

  return () => result!;
};

describe('getRefundInfo type-flip watcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears a refundsTx link when the form type flips to the same side as the linked original', async () => {
    // Expense form refunding an income original is valid; flipping to income makes
    // both sides income → the (now invalid) link must be dropped.
    const form = ref(
      makeForm({
        type: FORM_TYPES.expense,
        refundsTx: [{ transaction: makeTx('orig-1', TRANSACTION_TYPES.income) }],
      }),
    );
    const onRefundLinkCleared = vi.fn();
    setup({ form, onRefundLinkCleared });

    form.value.type = FORM_TYPES.income;
    await nextTick();

    expect(form.value.refundsTx).toBeUndefined();
    expect(onRefundLinkCleared).toHaveBeenCalledTimes(1);
  });

  it('clears a refundedByTxs link when the form type flips to the same side as the refunding txs', async () => {
    const form = ref(
      makeForm({
        type: FORM_TYPES.expense,
        refundedByTxs: [{ transaction: makeTx('refund-1', TRANSACTION_TYPES.income) }],
      }),
    );
    const onRefundLinkCleared = vi.fn();
    setup({ form, onRefundLinkCleared });

    form.value.type = FORM_TYPES.income;
    await nextTick();

    expect(form.value.refundedByTxs).toBeUndefined();
    expect(onRefundLinkCleared).toHaveBeenCalledTimes(1);
  });

  it('clears to null (not undefined) when the row already had refunds so the edit path clears them server-side', async () => {
    const form = ref(
      makeForm({
        type: FORM_TYPES.expense,
        refundsTx: [{ transaction: makeTx('orig-1', TRANSACTION_TYPES.income) }],
      }),
    );
    const getResult = setup({ form });
    // Simulate an existing transaction that was opened with a saved refund link.
    getResult().initialRefundsFormSlice.value.refundsTx = [{ transaction: makeTx('orig-1', TRANSACTION_TYPES.income) }];

    form.value.type = FORM_TYPES.income;
    await nextTick();

    expect(form.value.refundsTx).toBeNull();
  });

  it('clears to undefined when the only saved link is external, so the external link is not deleted', async () => {
    const refundTx = makeTx('refund-1', TRANSACTION_TYPES.income);
    vi.mocked(getRefundsForTransaction).mockResolvedValueOnce([
      { refundTxId: 'refund-1', originalTxId: null, splitId: null, amount: 20, refundTransaction: refundTx },
    ] as OriginalRefunds);

    const form = ref(makeForm({ type: FORM_TYPES.income }));
    const getResult = setup({ form, initialTransaction: refundTx });
    await flushPromises();

    expect(getResult().hasExternalRefundLink.value).toBe(true);
    expect(getResult().hasInAppRefundLinks.value).toBe(false);

    form.value.refundsTx = [{ transaction: makeTx('orig-1', TRANSACTION_TYPES.expense) }];
    form.value.type = FORM_TYPES.expense;
    await nextTick();

    expect(form.value.refundsTx).toBeUndefined();
    expect(getResult().isOriginalRefundsOverriden.value).toBe(false);
  });

  it('keeps the link when a type flip leaves the counterpart on the opposite side', async () => {
    // Income form with an income-type refundsTx is invalid, but the watcher only
    // reacts to changes: flipping to expense makes income the correct opposite, so
    // the link stays.
    const form = ref(
      makeForm({
        type: FORM_TYPES.income,
        refundsTx: [{ transaction: makeTx('orig-1', TRANSACTION_TYPES.income) }],
      }),
    );
    const onRefundLinkCleared = vi.fn();
    setup({ form, onRefundLinkCleared });

    form.value.type = FORM_TYPES.expense;
    await nextTick();

    expect(form.value.refundsTx).toEqual([{ transaction: expect.objectContaining({ id: 'orig-1' }) }]);
    expect(onRefundLinkCleared).not.toHaveBeenCalled();
  });
});

describe('getRefundInfo initial load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads every link where the transaction is the refund, with its share', async () => {
    const refundTx = makeTx('refund-1', TRANSACTION_TYPES.income);
    vi.mocked(getRefundsForTransaction).mockResolvedValueOnce([
      {
        refundTxId: 'refund-1',
        originalTxId: 'orig-1',
        splitId: null,
        amount: 60,
        originalTransaction: makeTx('orig-1', TRANSACTION_TYPES.expense),
        refundTransaction: refundTx,
      },
      {
        refundTxId: 'refund-1',
        originalTxId: 'orig-2',
        splitId: 'split-1',
        amount: 40,
        originalTransaction: makeTx('orig-2', TRANSACTION_TYPES.expense),
        refundTransaction: refundTx,
      },
    ] as OriginalRefunds);

    const form = ref(makeForm({ type: FORM_TYPES.income }));
    const getResult = setup({ form, initialTransaction: refundTx });
    await flushPromises();

    expect(getResult().initialRefundStatus.value).toBe('refunds');
    expect(getResult().initialRefundsFormSlice.value.refundsTx).toEqual([
      { transaction: expect.objectContaining({ id: 'orig-1' }), splitId: undefined, amount: 60 },
      { transaction: expect.objectContaining({ id: 'orig-2' }), splitId: 'split-1', amount: 40 },
    ]);
    expect(getResult().savedRefundShares.value).toEqual({ 'orig-1:': 60, 'orig-2:split-1': 40 });
  });

  it('keeps only same-currency saved shares, keyed per target', async () => {
    const withCurrency = ({ tx, currencyCode }: { tx: TransactionModel; currencyCode: string }) =>
      ({ ...tx, currencyCode }) as TransactionModel;
    const refundTx = withCurrency({ tx: makeTx('refund-1', TRANSACTION_TYPES.income), currencyCode: 'UAH' });
    const original = withCurrency({ tx: makeTx('orig-1', TRANSACTION_TYPES.expense), currencyCode: 'UAH' });
    vi.mocked(getRefundsForTransaction).mockResolvedValueOnce([
      {
        refundTxId: 'refund-1',
        originalTxId: 'orig-1',
        splitId: null,
        amount: 30,
        originalTransaction: original,
        refundTransaction: refundTx,
      },
      {
        refundTxId: 'refund-1',
        originalTxId: 'orig-1',
        splitId: 'split-1',
        amount: 20,
        originalTransaction: original,
        refundTransaction: refundTx,
      },
      {
        refundTxId: 'refund-1',
        originalTxId: 'orig-2',
        splitId: null,
        amount: 50,
        originalTransaction: withCurrency({ tx: makeTx('orig-2', TRANSACTION_TYPES.expense), currencyCode: 'PLN' }),
        refundTransaction: refundTx,
      },
    ] as OriginalRefunds);

    const form = ref(makeForm({ type: FORM_TYPES.income }));
    const getResult = setup({ form, initialTransaction: refundTx });
    await flushPromises();

    expect(getResult().savedRefundShares.value).toEqual({ 'orig-1:': 30, 'orig-1:split-1': 20 });
  });

  it('skips refund links whose original transaction is outside the app', async () => {
    const refundTx = makeTx('refund-1', TRANSACTION_TYPES.income);
    vi.mocked(getRefundsForTransaction).mockResolvedValueOnce([
      {
        refundTxId: 'refund-1',
        originalTxId: null,
        splitId: null,
        amount: 20,
        refundTransaction: refundTx,
      },
      {
        refundTxId: 'refund-1',
        originalTxId: 'orig-1',
        splitId: null,
        amount: 80,
        originalTransaction: makeTx('orig-1', TRANSACTION_TYPES.expense),
        refundTransaction: refundTx,
      },
    ] as OriginalRefunds);

    const form = ref(makeForm({ type: FORM_TYPES.income }));
    const getResult = setup({ form, initialTransaction: refundTx });
    await flushPromises();

    expect(getResult().initialRefundStatus.value).toBe('refunds');
    expect(getResult().initialRefundsFormSlice.value.refundsTx).toEqual([
      { transaction: expect.objectContaining({ id: 'orig-1' }), splitId: undefined, amount: 80 },
    ]);
    expect(getResult().hasExternalRefundLink.value).toBe(true);
  });

  it('loads every link where the transaction is the original, with its share', async () => {
    const original = makeTx('orig-1', TRANSACTION_TYPES.expense);
    vi.mocked(getRefundsForTransaction).mockResolvedValueOnce([
      {
        refundTxId: 'refund-1',
        originalTxId: 'orig-1',
        splitId: null,
        amount: 30,
        originalTransaction: original,
        refundTransaction: makeTx('refund-1', TRANSACTION_TYPES.income),
      },
      {
        refundTxId: 'refund-2',
        originalTxId: 'orig-1',
        splitId: null,
        amount: null,
        originalTransaction: original,
        refundTransaction: makeTx('refund-2', TRANSACTION_TYPES.income),
      },
    ] as OriginalRefunds);

    const form = ref(makeForm({ type: FORM_TYPES.expense }));
    const getResult = setup({ form, initialTransaction: original });
    await flushPromises();

    expect(getResult().initialRefundStatus.value).toBe('refunded');
    expect(getResult().initialRefundsFormSlice.value.refundedByTxs).toEqual([
      { transaction: expect.objectContaining({ id: 'refund-1' }), splitId: undefined, amount: 30 },
      { transaction: expect.objectContaining({ id: 'refund-2' }), splitId: undefined, amount: null },
    ]);
  });

  it('marks the load finished and failed without a toast when fetching links throws a non-API error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getRefundsForTransaction).mockRejectedValueOnce(new Error('boom'));

    const form = ref(makeForm({ type: FORM_TYPES.expense }));
    const getResult = setup({ form, initialTransaction: makeTx('orig-1', TRANSACTION_TYPES.expense) });
    await flushPromises();

    expect(getResult().isInitialRefundsDataLoaded.value).toBe(true);
    expect(getResult().isRefundsLoadFailed.value).toBe(true);
    expect(getResult().initialRefundStatus.value).toBeNull();
    expect(addErrorNotification).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('shows the server message when fetching links fails with an API error', async () => {
    vi.mocked(getRefundsForTransaction).mockRejectedValueOnce(
      new ApiErrorResponseError('boom', { code: API_ERROR_CODES.notFound, message: 'Transaction not found' }),
    );

    const form = ref(makeForm({ type: FORM_TYPES.expense }));
    const getResult = setup({ form, initialTransaction: makeTx('orig-1', TRANSACTION_TYPES.expense) });
    await flushPromises();

    expect(getResult().isRefundsLoadFailed.value).toBe(true);
    expect(addErrorNotification).toHaveBeenCalledWith('Transaction not found');
  });
});

describe('getRefundInfo override detection', () => {
  it('treats a changed share or an added target as overridden', () => {
    const original = makeTx('orig-1', TRANSACTION_TYPES.expense);
    const form = ref(makeForm({ type: FORM_TYPES.income }));
    const getResult = setup({ form });
    getResult().initialRefundsFormSlice.value.refundsTx = [{ transaction: original, amount: null }];

    form.value.refundsTx = [{ transaction: original, amount: null }];
    expect(getResult().isOriginalRefundsOverriden.value).toBe(false);

    form.value.refundsTx = [{ transaction: original, amount: 30 }];
    expect(getResult().isOriginalRefundsOverriden.value).toBe(true);

    form.value.refundsTx = [
      { transaction: original, amount: null },
      { transaction: makeTx('orig-2', TRANSACTION_TYPES.expense), amount: 10 },
    ];
    expect(getResult().isOriginalRefundsOverriden.value).toBe(true);
  });
});

describe('getRefundInfo amount watcher', () => {
  const purchase = ({ id, amount }: { id: string; amount: number }) =>
    ({ id, amount, currencyCode: 'UAH', transactionType: TRANSACTION_TYPES.expense }) as unknown as TransactionModel;
  const account = ({ currencyCode }: { currencyCode: string }) => ({ currencyCode }) as AccountModel;

  const makeRefundForm = ({ firstShare, isFirstAdjusted }: { firstShare: number; isFirstAdjusted: boolean }) =>
    ref(
      makeForm({
        type: FORM_TYPES.income,
        amount: 100,
        account: account({ currencyCode: 'UAH' }),
        refundsTx: [
          { transaction: purchase({ id: 'orig-1', amount: 300 }), amount: firstShare, isAdjusted: isFirstAdjusted },
          { transaction: purchase({ id: 'orig-2', amount: 300 }), amount: 100 - firstShare, isAdjusted: false },
        ],
      }),
    );

  it('refills app-filled shares when the refund amount changes', async () => {
    const form = makeRefundForm({ firstShare: 100, isFirstAdjusted: false });
    setup({ form });

    form.value.amount = 450;
    await nextTick();

    expect(form.value.refundsTx?.map((link) => link.amount)).toEqual([300, 150]);
  });

  it('keeps an adjusted share when the refund amount changes', async () => {
    const form = makeRefundForm({ firstShare: 30, isFirstAdjusted: true });
    setup({ form });

    form.value.amount = 150;
    await nextTick();

    expect(form.value.refundsTx?.map((link) => link.amount)).toEqual([30, 120]);
  });

  it('drops adjustments when the currency changes', async () => {
    const form = makeRefundForm({ firstShare: 30, isFirstAdjusted: true });
    setup({ form });

    form.value.account = account({ currencyCode: 'EUR' });
    await nextTick();

    expect(form.value.refundsTx?.map((link) => [link.amount, link.isAdjusted])).toEqual([
      [100, false],
      [0, false],
    ]);
  });

  it('resets adjusted shares only when the currency really changes', async () => {
    const form = makeRefundForm({ firstShare: 30, isFirstAdjusted: true });
    setup({ form });

    form.value.account = account({ currencyCode: 'UAH' });
    form.value.amount = 150;
    await nextTick();

    expect(form.value.refundsTx?.map((link) => [link.amount, link.isAdjusted])).toEqual([
      [30, true],
      [120, false],
    ]);

    form.value.account = account({ currencyCode: 'EUR' });
    await nextTick();

    expect(form.value.refundsTx?.map((link) => [link.amount, link.isAdjusted])).toEqual([
      [150, false],
      [0, false],
    ]);
  });

  it('flags adjusted shares left above a lowered refund amount, ignoring float noise', async () => {
    const form = ref(
      makeForm({
        type: FORM_TYPES.income,
        amount: 0.3,
        account: account({ currencyCode: 'UAH' }),
        refundsTx: [
          { transaction: purchase({ id: 'orig-1', amount: 300 }), amount: 0.1, isAdjusted: true },
          { transaction: purchase({ id: 'orig-2', amount: 300 }), amount: 0.2, isAdjusted: true },
        ],
      }),
    );
    const getResult = setup({ form });

    expect(getResult().isRefundSharesOverAssigned.value).toBe(false);

    form.value.amount = 0.29;
    await nextTick();

    expect(getResult().isRefundSharesOverAssigned.value).toBe(true);
  });

  it('does not count the saved share as refunded by others when the refund amount grows', async () => {
    const refundTx = {
      id: 'refund-1',
      amount: 60,
      currencyCode: 'UAH',
      transactionType: TRANSACTION_TYPES.income,
    } as unknown as TransactionModel;
    const original = { ...purchase({ id: 'orig-1', amount: 100 }), refundedAmount: 60 } as TransactionModel;
    vi.mocked(getRefundsForTransaction).mockResolvedValueOnce([
      {
        refundTxId: 'refund-1',
        originalTxId: 'orig-1',
        splitId: null,
        amount: null,
        originalTransaction: original,
        refundTransaction: refundTx,
      },
    ] as OriginalRefunds);

    const form = ref(
      makeForm({
        type: FORM_TYPES.income,
        amount: 60,
        account: account({ currencyCode: 'UAH' }),
        refundsTx: [{ transaction: original, amount: null }],
      }),
    );
    setup({ form, initialTransaction: refundTx });
    await flushPromises();

    form.value.amount = 100;
    await nextTick();

    // `null` is the whole 100; counting the saved 60 as someone else's would cap the share at 40.
    expect(form.value.refundsTx?.map((link) => link.amount)).toEqual([null]);
  });

  it('caps a refund bigger than the purchase when the purchase amount drops', async () => {
    const refund = { id: 'refund-1', amount: 80, currencyCode: 'UAH', transactionType: TRANSACTION_TYPES.income };
    const form = ref(
      makeForm({
        type: FORM_TYPES.expense,
        amount: 100,
        account: account({ currencyCode: 'UAH' }),
        refundedByTxs: [{ transaction: refund as unknown as TransactionModel, amount: null }],
      }),
    );
    setup({ form });

    form.value.amount = 50;
    await nextTick();

    expect(form.value.refundedByTxs?.map((link) => link.amount)).toEqual([50]);
  });
});
