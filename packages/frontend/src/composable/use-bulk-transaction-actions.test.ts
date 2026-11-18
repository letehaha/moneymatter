import { ACCOUNT_TYPES, type AccountModel, type RecordId, type TransactionModel } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { buildBulkTarget, isExternalTransaction, isUndeletableTx } from './use-bulk-transaction-actions';

const buildTx = (overrides: Partial<TransactionModel>): TransactionModel =>
  ({
    id: '00000000-0000-0000-0000-000000000001' as RecordId,
    accountId: '00000000-0000-0000-0000-000000000100' as RecordId,
    accountType: ACCOUNT_TYPES.system,
    ...overrides,
  }) as TransactionModel;

const buildAccount = (type: ACCOUNT_TYPES): AccountModel => ({ type }) as AccountModel;

describe('isExternalTransaction', () => {
  it('account type is authoritative when the account is loaded', () => {
    const tx = buildTx({ accountType: ACCOUNT_TYPES.monobank });

    expect(isExternalTransaction({ tx, account: buildAccount(ACCOUNT_TYPES.system) })).toBe(false);
    expect(isExternalTransaction({ tx, account: buildAccount(ACCOUNT_TYPES.monobank) })).toBe(true);
  });

  it('falls back to tx.accountType when the account has not loaded yet', () => {
    expect(isExternalTransaction({ tx: buildTx({ accountType: ACCOUNT_TYPES.system }), account: undefined })).toBe(
      false,
    );
    expect(isExternalTransaction({ tx: buildTx({ accountType: ACCOUNT_TYPES.monobank }), account: undefined })).toBe(
      true,
    );
    expect(
      isExternalTransaction({ tx: buildTx({ accountType: ACCOUNT_TYPES.enableBanking }), account: undefined }),
    ).toBe(true);
  });
});

describe('isUndeletableTx', () => {
  const SEAM = '2026-11-01T00:00:00.000Z';
  const seamAccount = { type: ACCOUNT_TYPES.monobank, bankSeamAt: SEAM } as AccountModel;
  const afterSeam = new Date('2026-11-02T12:00:00.000Z');

  it('allows deleting a row on a manual account', () => {
    expect(isUndeletableTx({ tx: buildTx({}), account: buildAccount(ACCOUNT_TYPES.system) })).toBe(false);
  });

  it('blocks deleting a bank-delivered row', () => {
    const tx = buildTx({ accountType: ACCOUNT_TYPES.monobank, time: afterSeam });
    expect(isUndeletableTx({ tx, account: seamAccount })).toBe(true);
  });

  it('blocks deleting a hand-entered row after the bank seam, but not one before it', () => {
    expect(isUndeletableTx({ tx: buildTx({ time: afterSeam }), account: seamAccount })).toBe(true);
    expect(isUndeletableTx({ tx: buildTx({ time: new Date('2026-10-31T12:00:00.000Z') }), account: seamAccount })).toBe(
      false,
    );
  });

  it('allows deleting a planned row on a bank account', () => {
    const tx = buildTx({ isPlanned: true, time: afterSeam });
    expect(isUndeletableTx({ tx, account: buildAccount(ACCOUNT_TYPES.monobank) })).toBe(false);
  });

  it('falls back to the row accountType when the account is unknown', () => {
    expect(isUndeletableTx({ tx: buildTx({}), account: undefined })).toBe(false);
    expect(isUndeletableTx({ tx: buildTx({ accountType: ACCOUNT_TYPES.monobank }), account: undefined })).toBe(true);
  });
});

describe('buildBulkTarget', () => {
  const matching = {
    summary: { count: 40, income: 0, expense: 0, net: 0, transfers: 0 },
    filters: { accountIds: ['account-1'] },
  };

  it('targets the filter selection with the unticked ids while select-all covers the result set', () => {
    expect(buildBulkTarget({ matching, excludedIds: ['tx-2'], selectedIds: ['tx-1'] })).toEqual({
      selection: { filters: matching.filters, excludedIds: ['tx-2'] },
    });
  });

  it('targets the ticked ids otherwise', () => {
    expect(buildBulkTarget({ matching: undefined, excludedIds: ['tx-2'], selectedIds: ['tx-1'] })).toEqual({
      transactionIds: ['tx-1'],
    });
  });
});
