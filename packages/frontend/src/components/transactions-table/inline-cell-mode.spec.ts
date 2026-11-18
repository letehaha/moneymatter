import {
  ACCOUNT_CATEGORIES,
  ACCOUNT_TYPES,
  type AccountModel,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  type TransactionModel,
  type TransactionPaymentPart,
  type TransactionSplitModel,
} from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { TABLE_COLUMN } from './columns';
import { type InlineCellMode, getBankLockCopy, getInlineCellMode } from './inline-cell-mode';

const manual = { type: ACCOUNT_TYPES.system, accountCategory: ACCOUNT_CATEGORIES.general } as AccountModel;
const bank = { type: ACCOUNT_TYPES.monobank, accountCategory: ACCOUNT_CATEGORIES.general } as AccountModel;
const vehicle = { type: ACCOUNT_TYPES.system, accountCategory: ACCOUNT_CATEGORIES.vehicle } as AccountModel;
const sharedWithMe = { ...manual, share: { isOwner: false } } as AccountModel;
const SEAM = '2026-11-01T00:00:00.000Z';
const seamBank = { ...bank, bankSeamAt: SEAM } as AccountModel;
const preSeam = { accountType: ACCOUNT_TYPES.system, time: new Date(new Date(SEAM).getTime() - 1) };
const atSeam = { accountType: ACCOUNT_TYPES.system, time: new Date(SEAM) };

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
  oppositeTx,
  oppositeAccount,
  canEdit = true,
}: {
  tx: TransactionModel;
  account: AccountModel | undefined;
  oppositeTx?: TransactionModel | undefined;
  oppositeAccount?: AccountModel;
  canEdit?: boolean;
}) =>
  ROW_COLUMNS.map((column) => getInlineCellMode({ tx, column, account, oppositeTx, oppositeAccount, canEdit }))
    .map((mode) => mode[0])
    .join(' ');

describe('getInlineCellMode', () => {
  // Columns: date account category payee amount note tags. e=edit b=bank d=details m=managed n=na
  it.each<[string, Parameters<typeof modesFor>[0], string]>([
    ['manual row', { tx: buildTx(), account: manual }, 'e e e e e e e'],
    ['bank-connected row', { tx: buildTx(), account: bank }, 'b b e e b e e'],
    ['planned row on a bank account', { tx: buildTx({ isPlanned: true }), account: bank }, 'e e e e e e e'],
    ['manual row before the bank seam', { tx: buildTx(preSeam), account: seamBank }, 'e b e e e e e'],
    ['manual row at the bank seam', { tx: buildTx(atSeam), account: seamBank }, 'b b e e b e e'],
    [
      'bank row before the bank seam',
      { tx: buildTx({ ...preSeam, accountType: ACCOUNT_TYPES.monobank }), account: seamBank },
      'b b e e b e e',
    ],
    [
      'transfer leg to a pre-seam manual row',
      {
        tx: buildTx({ ...preSeam, transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer }),
        account: manual,
        oppositeTx: buildTx({ ...preSeam, transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer }),
        oppositeAccount: seamBank,
      },
      'd b n n d e e',
    ],
    [
      'transfer leg to a manual row at the seam',
      {
        tx: buildTx({ ...atSeam, transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer }),
        account: manual,
        oppositeTx: buildTx({ ...atSeam, transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer }),
        oppositeAccount: seamBank,
      },
      'b b n n b e e',
    ],
    [
      'pre-seam manual leg on the linked account, other leg on a manual account',
      {
        tx: buildTx({ ...preSeam, transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer }),
        account: seamBank,
        oppositeTx: buildTx({ ...preSeam, transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer }),
        oppositeAccount: manual,
      },
      'd b n n d e e',
    ],
    [
      'manual leg at the seam on the linked account, other leg on a manual account',
      {
        tx: buildTx({ ...atSeam, transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer }),
        account: seamBank,
        oppositeTx: buildTx({ ...atSeam, transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer }),
        oppositeAccount: manual,
      },
      'b b n n b e e',
    ],
    [
      'transfer leg whose other leg on a linked account is not loaded',
      {
        tx: buildTx({ ...preSeam, transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer }),
        account: manual,
        oppositeTx: undefined,
        oppositeAccount: seamBank,
      },
      'b b n n b e e',
    ],
    [
      'transfer leg whose other leg is a bank row on an account that is not loaded',
      {
        tx: buildTx({ ...preSeam, transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer }),
        account: manual,
        oppositeTx: buildTx({
          ...preSeam,
          accountType: ACCOUNT_TYPES.monobank,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        }),
        oppositeAccount: undefined,
      },
      'b b n n b e e',
    ],
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
      'multi-account payment',
      { tx: buildTx({ paymentParts: [{} as TransactionPaymentPart, {} as TransactionPaymentPart] }), account: manual },
      'd d e e d e e',
    ],
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
      getInlineCellMode({
        tx: buildTx(),
        column,
        account: manual,
        oppositeTx: undefined,
        oppositeAccount: undefined,
        canEdit: true,
      }),
    );

    expect(modes).toEqual<InlineCellMode[]>(['na', 'na', 'na']);
  });
});

describe('getBankLockCopy', () => {
  const AFTER_LINK = {
    title: 'transactions.inlineEdit.manualAfterLinkTitle',
    description: 'transactions.inlineEdit.manualAfterLinkDescription',
    seamAt: SEAM,
  };
  const BANK_ACCOUNT = {
    title: 'transactions.inlineEdit.bankAccountTitle',
    description: 'transactions.inlineEdit.bankAccountDescription',
  };
  const transfer = { transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer };
  const bankRowPreSeam = { ...preSeam, accountType: ACCOUNT_TYPES.monobank };

  it.each<[string, Parameters<typeof getBankLockCopy>[0], ReturnType<typeof getBankLockCopy>]>([
    [
      'date of a manual row at the seam',
      {
        tx: buildTx(atSeam),
        column: TABLE_COLUMN.date,
        account: seamBank,
        oppositeTx: undefined,
        oppositeAccount: undefined,
      },
      AFTER_LINK,
    ],
    [
      'account of a manual row at the seam',
      {
        tx: buildTx(atSeam),
        column: TABLE_COLUMN.account,
        account: seamBank,
        oppositeTx: undefined,
        oppositeAccount: undefined,
      },
      AFTER_LINK,
    ],
    [
      'account of a manual row before the seam',
      {
        tx: buildTx(preSeam),
        column: TABLE_COLUMN.account,
        account: seamBank,
        oppositeTx: undefined,
        oppositeAccount: undefined,
      },
      BANK_ACCOUNT,
    ],
    [
      'date of a bank-delivered row',
      {
        tx: buildTx(bankRowPreSeam),
        column: TABLE_COLUMN.date,
        account: seamBank,
        oppositeTx: undefined,
        oppositeAccount: undefined,
      },
      null,
    ],
    [
      'date of a manual row on a bank account without a seam',
      {
        tx: buildTx(preSeam),
        column: TABLE_COLUMN.date,
        account: bank,
        oppositeTx: undefined,
        oppositeAccount: undefined,
      },
      null,
    ],
    [
      'date of a manual leg whose other leg is a manual row at the seam',
      {
        tx: buildTx({ ...atSeam, ...transfer }),
        column: TABLE_COLUMN.date,
        account: manual,
        oppositeTx: buildTx({ ...atSeam, ...transfer }),
        oppositeAccount: seamBank,
      },
      AFTER_LINK,
    ],
    [
      'date of a manual row at the seam whose other leg is on a manual account',
      {
        tx: buildTx({ ...atSeam, ...transfer }),
        column: TABLE_COLUMN.date,
        account: seamBank,
        oppositeTx: buildTx({ ...atSeam, ...transfer }),
        oppositeAccount: manual,
      },
      AFTER_LINK,
    ],
    [
      'date of a manual leg whose other leg is bank-delivered',
      {
        tx: buildTx({ ...preSeam, ...transfer }),
        column: TABLE_COLUMN.date,
        account: manual,
        oppositeTx: buildTx({ ...bankRowPreSeam, ...transfer }),
        oppositeAccount: seamBank,
      },
      null,
    ],
    [
      'date of a manual leg whose other leg is not loaded',
      {
        tx: buildTx({ ...preSeam, ...transfer }),
        column: TABLE_COLUMN.date,
        account: manual,
        oppositeTx: undefined,
        oppositeAccount: seamBank,
      },
      null,
    ],
  ])('%s', (_, input, expected) => {
    expect(getBankLockCopy(input)).toEqual(expected);
  });
});
