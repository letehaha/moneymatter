import {
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  TransactionModel,
  TransactionSplitModel,
  type RecordId,
} from '@bt/shared/types';
import { describe, expect, it } from 'vitest';
import { type Ref, nextTick, ref } from 'vue';

import {
  getVanishedSelectedIds,
  subtractTotals,
  sumSelectedTotals,
  useTransactionSelection,
} from './transaction-selection';

const buildTx = (overrides: Partial<TransactionModel>): TransactionModel =>
  ({
    id: '00000000-0000-0000-0000-000000000001' as RecordId,
    accountId: '00000000-0000-0000-0000-000000000100' as RecordId,
    splits: undefined,
    ...overrides,
  }) as TransactionModel;

describe('useTransactionSelection', () => {
  it('split parents are selectable', () => {
    const splitParent = buildTx({
      id: '00000000-0000-0000-0000-000000000001' as RecordId,
      splits: [
        {
          id: '00000000-0000-0000-0000-000000000011' as RecordId,
          transactionId: '00000000-0000-0000-0000-000000000001',
          userId: 100,
          categoryId: '00000000-0000-0000-0000-000000000001',
          amount: 100,
          refAmount: 100,
          note: null,
        } as TransactionSplitModel,
      ],
    });
    const regular = buildTx({ id: '00000000-0000-0000-0000-000000000002' as RecordId });
    const { isTransactionSelectable } = useTransactionSelection({
      getTransactions: () => [splitParent, regular],
    });

    expect(isTransactionSelectable(splitParent)).toBe(true);
    expect(isTransactionSelectable(regular)).toBe(true);
  });

  it('honors isExtraSelectable for callers that need an extra gate (e.g. shared-account lockout)', () => {
    const ownAccountTx = buildTx({
      id: '00000000-0000-0000-0000-000000000001' as RecordId,
      accountId: '00000000-0000-0000-0000-000000000100' as RecordId,
    });
    const sharedAccountTx = buildTx({
      id: '00000000-0000-0000-0000-000000000002' as RecordId,
      accountId: '00000000-0000-0000-0000-000000000200' as RecordId,
    });

    const { isTransactionSelectable } = useTransactionSelection({
      getTransactions: () => [ownAccountTx, sharedAccountTx],
      isExtraSelectable: (tx) => tx.accountId !== '00000000-0000-0000-0000-000000000200',
    });

    expect(isTransactionSelectable(ownAccountTx)).toBe(true);
    expect(isTransactionSelectable(sharedAccountTx)).toBe(false);
  });

  it('selectAll skips transactions blocked by isExtraSelectable', () => {
    const a = buildTx({
      id: '00000000-0000-0000-0000-000000000001' as RecordId,
      accountId: '00000000-0000-0000-0000-000000000100' as RecordId,
    });
    const b = buildTx({
      id: '00000000-0000-0000-0000-000000000002' as RecordId,
      accountId: '00000000-0000-0000-0000-000000000200' as RecordId,
    });
    const c = buildTx({
      id: '00000000-0000-0000-0000-000000000003' as RecordId,
      accountId: '00000000-0000-0000-0000-000000000100' as RecordId,
    });

    const { selectAll, selectedCount, isTransactionSelected } = useTransactionSelection({
      getTransactions: () => [a, b, c],
      isExtraSelectable: (tx) => tx.accountId === '00000000-0000-0000-0000-000000000100',
    });

    selectAll();

    expect(selectedCount.value).toBe(2);
    expect(isTransactionSelected('00000000-0000-0000-0000-000000000001')).toBe(true);
    expect(isTransactionSelected('00000000-0000-0000-0000-000000000002')).toBe(false);
    expect(isTransactionSelected('00000000-0000-0000-0000-000000000003')).toBe(true);
  });

  it('isAllSelected reflects the gated set, not the raw transaction list', () => {
    const a = buildTx({
      id: '00000000-0000-0000-0000-000000000001' as RecordId,
      accountId: '00000000-0000-0000-0000-000000000100' as RecordId,
    });
    const b = buildTx({
      id: '00000000-0000-0000-0000-000000000002' as RecordId,
      accountId: '00000000-0000-0000-0000-000000000200' as RecordId,
    });

    const { selectAll, isAllSelected } = useTransactionSelection({
      getTransactions: () => [a, b],
      isExtraSelectable: (tx) => tx.accountId === '00000000-0000-0000-0000-000000000100',
    });

    selectAll();
    expect(isAllSelected.value).toBe(true);
  });
});

describe('getVanishedSelectedIds', () => {
  it('reports the selected ids missing from the loaded rows', () => {
    expect(getVanishedSelectedIds({ selectedIds: ['a', 'b', 'c'], loadedIds: ['a', 'c'] })).toEqual(['b']);
  });

  it('reports nothing when the loaded list is empty', () => {
    expect(getVanishedSelectedIds({ selectedIds: ['a', 'b'], loadedIds: [] })).toEqual([]);
  });
});

const a = buildTx({ id: '00000000-0000-0000-0000-000000000001' as RecordId });
const b = buildTx({ id: '00000000-0000-0000-0000-000000000002' as RecordId });
const c = buildTx({ id: '00000000-0000-0000-0000-000000000003' as RecordId });

describe('useTransactionSelection — pruning against loaded rows', () => {
  it('drops selections whose rows vanished from the refetched list', async () => {
    const transactions = ref<TransactionModel[]>([a, b, c]);
    const { selectAll, selectedCount, isTransactionSelected } = useTransactionSelection({
      getTransactions: () => transactions.value,
    });

    selectAll();
    expect(selectedCount.value).toBe(3);

    transactions.value = [a, c];
    await nextTick();

    expect(selectedCount.value).toBe(2);
    expect(isTransactionSelected(b.id)).toBe(false);
    expect(isTransactionSelected(a.id)).toBe(true);
    expect(isTransactionSelected(c.id)).toBe(true);
  });

  it('keeps the selection while the list is transiently empty', async () => {
    const transactions = ref<TransactionModel[]>([a, b]);
    const { selectAll, selectedCount } = useTransactionSelection({
      getTransactions: () => transactions.value,
    });

    selectAll();

    transactions.value = [];
    await nextTick();

    expect(selectedCount.value).toBe(2);

    transactions.value = [a, b];
    await nextTick();

    expect(selectedCount.value).toBe(2);
  });

  it('keeps the selection when the next page is appended', async () => {
    const transactions = ref<TransactionModel[]>([a, b]);
    const { toggleTransaction, selectedCount, isTransactionSelected } = useTransactionSelection({
      getTransactions: () => transactions.value,
    });

    toggleTransaction({ value: true, id: a.id });
    toggleTransaction({ value: true, id: b.id });

    transactions.value = [a, b, c];
    await nextTick();

    expect(selectedCount.value).toBe(2);
    expect(isTransactionSelected(a.id)).toBe(true);
    expect(isTransactionSelected(b.id)).toBe(true);
    expect(isTransactionSelected(c.id)).toBe(false);
  });
});

describe('useTransactionSelection — scoped selection', () => {
  const buildScoped = ({ transactions, scopeKey }: { transactions: Ref<TransactionModel[]>; scopeKey: Ref<string> }) =>
    useTransactionSelection({
      getTransactions: () => transactions.value,
      getScopeKey: () => scopeKey.value,
    });

  it('clears the whole selection when the scope changes', async () => {
    const transactions = ref<TransactionModel[]>([a, b, c]);
    const scopeKey = ref('time:desc');
    const { selectAll, selectedCount } = buildScoped({ transactions, scopeKey });

    selectAll();
    expect(selectedCount.value).toBe(3);

    scopeKey.value = 'amount:asc';
    transactions.value = [a];
    await nextTick();

    expect(selectedCount.value).toBe(0);
  });

  it('prunes only genuinely vanished rows while the scope is stable', async () => {
    const transactions = ref<TransactionModel[]>([a, b, c]);
    const scopeKey = ref('time:desc');
    const { selectAll, selectedCount, isTransactionSelected } = buildScoped({ transactions, scopeKey });

    selectAll();

    transactions.value = [a, c];
    await nextTick();

    expect(selectedCount.value).toBe(2);
    expect(isTransactionSelected(b.id)).toBe(false);
  });

  it('keeps a manual selection as is when the next page is appended', async () => {
    const transactions = ref<TransactionModel[]>([a, b]);
    const scopeKey = ref('time:desc');
    const { toggleTransaction, selectedCount, isSelectAllActive } = buildScoped({ transactions, scopeKey });

    toggleTransaction({ value: true, id: a.id });
    toggleTransaction({ value: true, id: b.id });

    transactions.value = [a, b, c];
    await nextTick();

    expect(isSelectAllActive.value).toBe(false);
    expect(selectedCount.value).toBe(2);
  });

  it('after select all, rows that load later arrive selected and unticked rows stay unticked', async () => {
    const transactions = ref<TransactionModel[]>([a, b]);
    const scopeKey = ref('time:desc');
    const { selectAll, toggleTransaction, isTransactionSelected, isSelectAllActive } = buildScoped({
      transactions,
      scopeKey,
    });

    selectAll();
    toggleTransaction({ value: false, id: a.id });

    transactions.value = [a, b, c];
    await nextTick();

    expect(isSelectAllActive.value).toBe(true);
    expect(isTransactionSelected(a.id)).toBe(false);
    expect(isTransactionSelected(b.id)).toBe(true);
    expect(isTransactionSelected(c.id)).toBe(true);
  });

  it('keeps a row unticked when it leaves the loaded list and returns, or the list is briefly empty', async () => {
    const transactions = ref<TransactionModel[]>([a, b, c]);
    const scopeKey = ref('time:desc');
    const { selectAll, toggleTransaction, isTransactionSelected, excludedIds } = buildScoped({
      transactions,
      scopeKey,
    });

    selectAll();
    toggleTransaction({ value: false, id: a.id });

    transactions.value = [b, c];
    await nextTick();
    transactions.value = [];
    await nextTick();
    transactions.value = [a, b, c];
    await nextTick();

    expect(isTransactionSelected(a.id)).toBe(false);
    expect(isTransactionSelected(b.id)).toBe(true);
    expect([...excludedIds.value]).toEqual([a.id]);
  });

  it('drops select-all mode when the scope changes', async () => {
    const transactions = ref<TransactionModel[]>([a, b]);
    const scopeKey = ref('time:desc');
    const { selectAll, isSelectAllActive, selectedCount } = buildScoped({ transactions, scopeKey });

    selectAll();
    scopeKey.value = 'amount:asc';
    transactions.value = [c];
    await nextTick();

    expect(isSelectAllActive.value).toBe(false);
    expect(selectedCount.value).toBe(0);
  });

  it('leaves select-all mode once the selection is cleared or emptied by hand', async () => {
    const transactions = ref<TransactionModel[]>([a]);
    const scopeKey = ref('time:desc');
    const { selectAll, toggleTransaction, isSelectAllActive, selectedCount } = buildScoped({ transactions, scopeKey });

    selectAll();
    toggleTransaction({ value: false, id: a.id });
    await nextTick();
    expect(isSelectAllActive.value).toBe(false);

    transactions.value = [a, b];
    await nextTick();
    expect(selectedCount.value).toBe(0);
  });

  it('keeps the selection while the list is transiently empty within the same scope', async () => {
    const transactions = ref<TransactionModel[]>([a, b]);
    const scopeKey = ref('time:desc');
    const { selectAll, selectedCount } = buildScoped({ transactions, scopeKey });

    selectAll();

    transactions.value = [];
    await nextTick();

    expect(selectedCount.value).toBe(2);
  });
});

describe('sumSelectedTotals', () => {
  const buildAmountTx = ({
    id,
    transactionType,
    refAmount,
    transferNature = TRANSACTION_TRANSFER_NATURE.not_transfer,
  }: {
    id: string;
    transactionType: TRANSACTION_TYPES;
    refAmount: number;
    transferNature?: TRANSACTION_TRANSFER_NATURE;
  }) => buildTx({ id: id as RecordId, transactionType, refAmount, transferNature });

  it('partitions on transactionType and ignores unselected rows', () => {
    const transactions = [
      buildAmountTx({ id: '1', transactionType: TRANSACTION_TYPES.income, refAmount: 500 }),
      buildAmountTx({ id: '2', transactionType: TRANSACTION_TYPES.expense, refAmount: 120 }),
      buildAmountTx({ id: '3', transactionType: TRANSACTION_TYPES.expense, refAmount: 80 }),
      buildAmountTx({ id: '4', transactionType: TRANSACTION_TYPES.income, refAmount: 999 }),
    ];

    expect(sumSelectedTotals({ transactions, selectedIds: new Set(['1', '2', '3']) })).toEqual({
      income: 500,
      expense: 200,
      net: 300,
      transfers: 0,
    });
  });

  it.each([
    ['common_transfer', TRANSACTION_TRANSFER_NATURE.common_transfer],
    ['transfer_to_loan', TRANSACTION_TRANSFER_NATURE.transfer_to_loan],
    ['transfer_to_portfolio', TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio],
    ['transfer_to_venture', TRANSACTION_TRANSFER_NATURE.transfer_to_venture],
  ])('keeps %s out of income/expense and reports it as a transfer', (_name, transferNature) => {
    const transactions = [
      buildAmountTx({ id: '1', transactionType: TRANSACTION_TYPES.expense, refAmount: 4350, transferNature }),
    ];

    expect(sumSelectedTotals({ transactions, selectedIds: new Set(['1']) })).toEqual({
      income: 0,
      expense: 0,
      net: 0,
      transfers: 4350,
    });
  });

  it('counts transfer_out_wallet as an ordinary expense', () => {
    const transactions = [
      buildAmountTx({
        id: '1',
        transactionType: TRANSACTION_TYPES.expense,
        refAmount: 300,
        transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
      }),
    ];

    expect(sumSelectedTotals({ transactions, selectedIds: new Set(['1']) })).toEqual({
      income: 0,
      expense: 300,
      net: -300,
      transfers: 0,
    });
  });

  it('keeps the income leg of a transfer out of income', () => {
    const transactions = [
      buildAmountTx({
        id: '1',
        transactionType: TRANSACTION_TYPES.income,
        refAmount: 4350,
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      }),
    ];

    expect(sumSelectedTotals({ transactions, selectedIds: new Set(['1']) })).toEqual({
      income: 0,
      expense: 0,
      net: 0,
      transfers: 4350,
    });
  });

  it('returns zeros for an empty selection', () => {
    const transactions = [buildAmountTx({ id: '1', transactionType: TRANSACTION_TYPES.income, refAmount: 500 })];

    expect(sumSelectedTotals({ transactions, selectedIds: new Set() })).toEqual({
      income: 0,
      expense: 0,
      net: 0,
      transfers: 0,
    });
  });
});

describe('subtractTotals', () => {
  it('removes the unticked rows from the whole-set totals and recomputes net', () => {
    expect(
      subtractTotals({
        from: { income: 300, expense: 170, net: 130, transfers: 500 },
        minus: { income: 100, expense: 20, net: 80, transfers: 500 },
      }),
    ).toEqual({ income: 200, expense: 150, net: 50, transfers: 0 });
  });
});
