import {
  ACCOUNT_CATEGORIES,
  ACCOUNT_TYPES,
  type AccountModel,
  isTwoLegTransfer,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  type TransactionModel,
} from '@bt/shared/types';

import { TABLE_COLUMN } from './columns';

/**
 * - `edit`: the cell opens its inline editor
 * - `bank`: the value comes from the bank connection
 * - `details`: the change spans more than this cell (transfer legs, splits), so the full editor opens
 * - `managed`: the row is owned by another feature (portfolio, venture, vehicle, loan)
 * - `na`: not inline-editable, the click falls through to the row
 */
export type InlineCellMode = 'edit' | 'bank' | 'details' | 'managed' | 'na';

/** Modes whose cell handles the click itself instead of passing it to the row. */
const CLAIMED_CELL_MODES = ['edit', 'bank', 'managed'] as const satisfies InlineCellMode[];

export type ClaimedCellMode = (typeof CLAIMED_CELL_MODES)[number];

export const isClaimedCellMode = (mode: InlineCellMode): mode is ClaimedCellMode =>
  (CLAIMED_CELL_MODES as readonly InlineCellMode[]).includes(mode);

export const INLINE_EDITABLE_COLUMNS = [
  TABLE_COLUMN.date,
  TABLE_COLUMN.account,
  TABLE_COLUMN.category,
  TABLE_COLUMN.payee,
  TABLE_COLUMN.amount,
  TABLE_COLUMN.note,
  TABLE_COLUMN.tags,
] as const;

export type InlineEditableColumn = (typeof INLINE_EDITABLE_COLUMNS)[number];

export const isInlineEditableColumn = (column: TABLE_COLUMN): column is InlineEditableColumn =>
  (INLINE_EDITABLE_COLUMNS as readonly TABLE_COLUMN[]).includes(column);

const BANK_OWNED_COLUMNS: TABLE_COLUMN[] = [TABLE_COLUMN.date, TABLE_COLUMN.account, TABLE_COLUMN.amount];

const isExternal = ({ account }: { account: AccountModel | undefined }) =>
  !!account && account.type !== ACCOUNT_TYPES.system;

const isManagedElsewhere = ({ tx, account }: { tx: TransactionModel; account: AccountModel }) => {
  switch (tx.transferNature) {
    case TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio:
    case TRANSACTION_TRANSFER_NATURE.transfer_to_venture:
      return true;
    case TRANSACTION_TRANSFER_NATURE.transfer_to_loan:
      return tx.transactionType === TRANSACTION_TYPES.income;
    // Vehicle value adjustments: the server doesn't guard these, the vehicle page does.
    case TRANSACTION_TRANSFER_NATURE.transfer_out_wallet:
      return account.accountCategory === ACCOUNT_CATEGORIES.vehicle;
    default:
      return false;
  }
};

export const getInlineCellMode = ({
  tx,
  column,
  account,
  oppositeAccount,
  canEdit,
}: {
  tx: TransactionModel;
  column: TABLE_COLUMN;
  account: AccountModel | undefined;
  oppositeAccount: AccountModel | undefined;
  canEdit: boolean;
}): InlineCellMode => {
  if (!isInlineEditableColumn(column) || !account || !canEdit) return 'na';
  if (isManagedElsewhere({ tx, account })) return 'managed';

  const isTwoLeg = isTwoLegTransfer(tx.transferNature);
  const isTransfer = isTwoLeg || tx.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_out_wallet;

  if (isTransfer && (column === TABLE_COLUMN.category || column === TABLE_COLUMN.payee)) return 'na';
  if (column === TABLE_COLUMN.account && account.share && !account.share.isOwner) return 'na';

  if (BANK_OWNED_COLUMNS.includes(column)) {
    // The server checks only the edited leg's account, then writes date and amount onto the other leg too.
    if (isTwoLeg) return isExternal({ account }) || isExternal({ account: oppositeAccount }) ? 'bank' : 'details';
    if (isExternal({ account }) && !tx.isPlanned) return 'bank';
    // The server re-checks split sums and recalculates split ref amounts only when splits are sent along.
    if (tx.splits?.length) return 'details';
    return 'edit';
  }

  // Saving an income leg on its own rewrites the other leg as income too; the full editor rebases on the expense leg.
  if (isTwoLeg && tx.transactionType === TRANSACTION_TYPES.income) return 'details';

  return 'edit';
};
