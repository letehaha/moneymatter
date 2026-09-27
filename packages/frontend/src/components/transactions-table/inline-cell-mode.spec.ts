import {
  ACCOUNT_CATEGORIES,
  ACCOUNT_TYPES,
  type AccountModel,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  type TransactionModel,
  type TransactionSplitModel,
} from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { TABLE_COLUMN } from './columns';
import { type InlineCellMode, getInlineCellMode } from './inline-cell-mode';

const manual = { type: ACCOUNT_TYPES.system, accountCategory: ACCOUNT_CATEGORIES.general } as AccountModel;
const bank = { type: ACCOUNT_TYPES.monobank, accountCategory: ACCOUNT_CATEGORIES.general } as AccountModel;
const vehicle = { type: ACCOUNT_TYPES.system, accountCategory: ACCOUNT_CATEGORIES.vehicle } as AccountModel;
const sharedWithMe = { ...manual, share: { isOwner: false } } as AccountModel;

const buildTx = (overrides: Partial<TransactionModel> = {}) =>
  ({
    transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
    transactionType: TRANSACTION_TYPES.expense,
    isPlanned: false,
    splits: undefined,
    ...overrides,
  }) as TransactionModel;

const ROW_COLUMNS = [
  TABLE_COLUMN.date,
  TABLE_COLUMN.account,
  TABLE_COLUMN.category,
  TABLE_COLUMN.payee,
  TABLE_COLUMN.amount,
  TABLE_COLUMN.note,
  TABLE_COLUMN.tags,
];

const modesFor = ({
  tx,
  account,
  oppositeAccount,
  canEdit = true,
}: {
  tx: TransactionModel;
  account: AccountModel | undefined;
  oppositeAccount?: AccountModel;
  canEdit?: boolean;
}) =>
  ROW_COLUMNS.map((column) => getInlineCellMode({ tx, column, account, oppositeAccount, canEdit }))
    .map((mode) => mode[0])
    .join(' ');

describe('getInlineCellMode', () => {
  // Columns: date account category payee amount note tags. e=edit b=bank d=details m=managed n=na
  it.each<[string, Parameters<typeof modesFor>[0], string]>([
    ['manual row', { tx: buildTx(), account: manual }, 'e e e e e e e'],
    ['bank-connected row', { tx: buildTx(), account: bank }, 'b b e e b e e'],
    ['planned row on a bank account', { tx: buildTx({ isPlanned: true }), account: bank }, 'e e e e e e e'],
    [
      'transfer between manual accounts',
      {
        tx: buildTx({ transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer }),
        account: manual,
        oppositeAccount: manual,
      },
      'd d n n d e e',
    ],
    [
      'manual leg of a transfer to a bank account',
      {
        tx: buildTx({ transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer }),
        account: manual,
        oppositeAccount: bank,
      },
      'b b n n b e e',
    ],
    [
      'income leg of a transfer shown alone',
      {
        tx: buildTx({
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          transactionType: TRANSACTION_TYPES.income,
        }),
        account: manual,
      },
      'd d n n d d d',
    ],
    [
      'out-of-wallet transfer',
      { tx: buildTx({ transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet }), account: manual },
      'e e n n e e e',
    ],
    ['split parent', { tx: buildTx({ splits: [{} as TransactionSplitModel] }), account: manual }, 'd d e e d e e'],
    [
      'split parent on a bank account',
      { tx: buildTx({ splits: [{} as TransactionSplitModel] }), account: bank },
      'b b e e b e e',
    ],
    [
      'loan payment',
      { tx: buildTx({ transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan }), account: manual },
      'd d n n d e e',
    ],
    [
      'loan side of a loan payment',
      {
        tx: buildTx({
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          transactionType: TRANSACTION_TYPES.income,
        }),
        account: manual,
      },
      'm m m m m m m',
    ],
    [
      'portfolio transfer',
      { tx: buildTx({ transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio }), account: manual },
      'm m m m m m m',
    ],
    [
      'venture transfer',
      { tx: buildTx({ transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_venture }), account: manual },
      'm m m m m m m',
    ],
    [
      'vehicle value adjustment',
      { tx: buildTx({ transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet }), account: vehicle },
      'm m m m m m m',
    ],
    ['row on an account shared with the caller', { tx: buildTx(), account: sharedWithMe }, 'e n e e e e e'],
    ['row the caller cannot edit', { tx: buildTx(), account: manual, canEdit: false }, 'n n n n n n n'],
    ['row whose account is not loaded', { tx: buildTx(), account: undefined }, 'n n n n n n n'],
  ])('%s', (_, input, expected) => {
    expect(modesFor(input)).toBe(expected);
  });

  it('keeps non-editable columns on the row click', () => {
    const modes = [TABLE_COLUMN.refAmount, TABLE_COLUMN.group, TABLE_COLUMN.splitIndicator].map((column) =>
      getInlineCellMode({ tx: buildTx(), column, account: manual, oppositeAccount: undefined, canEdit: true }),
    );

    expect(modes).toEqual<InlineCellMode[]>(['na', 'na', 'na']);
  });
});
