import { RECONCILIATION_MERGE_MAX, RECONCILIATION_REMOVE_MAX } from '@bt/shared/const/reconciliation';
import {
  ACCOUNT_TYPES,
  type AccountModel,
  type RecordId,
  TRANSACTION_TRANSFER_NATURE,
  type TransactionModel,
} from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { getReconciliationBlockReasons } from './block-reasons';

const ACCOUNT_A = 'acc-a' as RecordId;
const ACCOUNT_B = 'acc-b' as RecordId;

const buildTx = (overrides: Partial<TransactionModel> = {}): TransactionModel =>
  ({
    id: 'tx' as RecordId,
    accountId: ACCOUNT_A,
    accountType: ACCOUNT_TYPES.enableBanking,
    isPlanned: false,
    transferId: null,
    transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
    refundLinked: false,
    ...overrides,
  }) as unknown as TransactionModel;

const accountsRecord: Record<string, AccountModel> = {
  [ACCOUNT_A]: { type: ACCOUNT_TYPES.enableBanking } as AccountModel,
  [ACCOUNT_B]: { type: ACCOUNT_TYPES.enableBanking } as AccountModel,
  system: { type: ACCOUNT_TYPES.system } as AccountModel,
};

describe('getReconciliationBlockReasons', () => {
  it('allows two clean bank rows on one account, and a wallet-out row without a link', () => {
    const transactions = [buildTx(), buildTx({ transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet })];

    expect(getReconciliationBlockReasons({ action: 'merge', transactions, accountsRecord })).toEqual([]);
    expect(getReconciliationBlockReasons({ action: 'remove', transactions, accountsRecord })).toEqual([]);
  });

  it('collects every blocking rule', () => {
    const transactions = [
      buildTx({ accountId: 'system' as RecordId }),
      buildTx({ isPlanned: true }),
      buildTx({ transferId: 'link' as RecordId }),
      buildTx({ transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer }),
      buildTx({ refundLinked: true, accountId: ACCOUNT_B }),
    ];

    expect(getReconciliationBlockReasons({ action: 'merge', transactions, accountsRecord })).toEqual([
      'notBankConnected',
      'planned',
      'linkedTransfer',
      'refundLinked',
      'tooMany',
      'differentAccounts',
    ]);
    expect(getReconciliationBlockReasons({ action: 'remove', transactions, accountsRecord })).toEqual([
      'notBankConnected',
      'planned',
      'linkedTransfer',
      'refundLinked',
    ]);
  });

  it('enforces row-count limits per action', () => {
    expect(getReconciliationBlockReasons({ action: 'merge', transactions: [buildTx()], accountsRecord })).toEqual([
      'tooFew',
    ]);
    expect(getReconciliationBlockReasons({ action: 'remove', transactions: [buildTx()], accountsRecord })).toEqual([]);

    const tooManyForMerge = Array.from({ length: RECONCILIATION_MERGE_MAX + 1 }, () => buildTx());
    expect(getReconciliationBlockReasons({ action: 'merge', transactions: tooManyForMerge, accountsRecord })).toEqual([
      'tooMany',
    ]);
    expect(getReconciliationBlockReasons({ action: 'remove', transactions: tooManyForMerge, accountsRecord })).toEqual(
      [],
    );
  });

  it('allows merge at exactly the max, and blocks remove above its max', () => {
    const atMergeMax = Array.from({ length: RECONCILIATION_MERGE_MAX }, () => buildTx());
    expect(getReconciliationBlockReasons({ action: 'merge', transactions: atMergeMax, accountsRecord })).toEqual([]);

    const tooManyForRemove = Array.from({ length: RECONCILIATION_REMOVE_MAX + 1 }, () => buildTx());
    expect(getReconciliationBlockReasons({ action: 'remove', transactions: tooManyForRemove, accountsRecord })).toEqual(
      ['tooMany'],
    );
  });

  it.each([
    TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
    TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio,
    TRANSACTION_TRANSFER_NATURE.transfer_to_venture,
  ])('blocks a %s row as a linked transfer', (transferNature) => {
    const transactions = [buildTx({ transferNature })];

    expect(getReconciliationBlockReasons({ action: 'remove', transactions, accountsRecord })).toEqual([
      'linkedTransfer',
    ]);
  });
});
