import { ACCOUNT_TYPES, type AccountModel, type RecordId, type TransactionModel } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { buildBulkTarget, isUndeletableTx } from './use-bulk-transaction-actions';

const ACCOUNT_ID = '00000000-0000-0000-0000-000000000100' as RecordId;
const OPPOSITE_ACCOUNT_ID = '00000000-0000-0000-0000-000000000200' as RecordId;

const buildTx = (overrides: Partial<TransactionModel>): TransactionModel =>
  ({
    id: '00000000-0000-0000-0000-000000000001' as RecordId,
    accountId: ACCOUNT_ID,
    accountType: ACCOUNT_TYPES.system,
    ...overrides,
  }) as TransactionModel;

const buildAccount = (type: ACCOUNT_TYPES): AccountModel => ({ type }) as AccountModel;

const check = ({
  tx,
  account,
  oppositeTx,
  oppositeAccount,
}: {
  tx: TransactionModel;
  account: AccountModel | undefined;
  oppositeTx?: TransactionModel;
  oppositeAccount?: AccountModel;
}) =>
  isUndeletableTx({
    tx,
    oppositeTx,
    accountsRecord: { [ACCOUNT_ID]: account, [OPPOSITE_ACCOUNT_ID]: oppositeAccount },
  });

describe('isUndeletableTx', () => {
  const SEAM = '2026-11-01T00:00:00.000Z';
  const seamAccount = { type: ACCOUNT_TYPES.monobank, bankSeamAt: SEAM } as AccountModel;
  const afterSeam = new Date('2026-11-02T12:00:00.000Z');

  it('allows deleting a row on a manual account', () => {
    expect(check({ tx: buildTx({}), account: buildAccount(ACCOUNT_TYPES.system) })).toBe(false);
  });

  it('blocks deleting a bank-delivered row', () => {
    const tx = buildTx({ accountType: ACCOUNT_TYPES.monobank, time: afterSeam });
    expect(check({ tx, account: seamAccount })).toBe(true);
  });

  it('blocks deleting a hand-entered row after the bank seam, but not one before it', () => {
    expect(check({ tx: buildTx({ time: afterSeam }), account: seamAccount })).toBe(true);
    expect(check({ tx: buildTx({ time: new Date('2026-10-31T12:00:00.000Z') }), account: seamAccount })).toBe(false);
  });

  it('allows deleting a planned row on a bank account', () => {
    const tx = buildTx({ isPlanned: true, time: afterSeam });
    expect(check({ tx, account: buildAccount(ACCOUNT_TYPES.monobank) })).toBe(false);
  });

  it('falls back to the row accountType when the account is unknown', () => {
    expect(check({ tx: buildTx({}), account: undefined })).toBe(false);
    expect(check({ tx: buildTx({ accountType: ACCOUNT_TYPES.monobank }), account: undefined })).toBe(true);
  });

  it('blocks deleting a deletable transfer leg whose opposite leg is bank-locked', () => {
    const oppositeTx = buildTx({
      id: '00000000-0000-0000-0000-000000000002' as RecordId,
      accountId: OPPOSITE_ACCOUNT_ID,
      accountType: ACCOUNT_TYPES.monobank,
      time: afterSeam,
    });
    const tx = buildTx({ time: afterSeam });

    expect(check({ tx, account: buildAccount(ACCOUNT_TYPES.system), oppositeTx, oppositeAccount: seamAccount })).toBe(
      true,
    );
    expect(
      check({
        tx,
        account: buildAccount(ACCOUNT_TYPES.system),
        oppositeTx: { ...oppositeTx, accountType: ACCOUNT_TYPES.system },
        oppositeAccount: buildAccount(ACCOUNT_TYPES.system),
      }),
    ).toBe(false);
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
