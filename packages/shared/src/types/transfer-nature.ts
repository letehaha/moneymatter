import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from './enums';

/**
 * `common_transfer` and `transfer_to_loan` share every two-leg invariant
 * (linked `transferId`, opposite-direction legs, balance debit/credit), so all
 * branches driving creation/update/deletion/UI must treat them identically.
 * The label differs only so loan views can isolate payments without joining
 * through the destination account's category.
 */
export const isTwoLegTransfer = (nature: TRANSACTION_TRANSFER_NATURE | undefined | null): boolean =>
  nature === TRANSACTION_TRANSFER_NATURE.common_transfer || nature === TRANSACTION_TRANSFER_NATURE.transfer_to_loan;

/**
 * Money that stays inside the user's tracked world, so it is neither income nor
 * expense. `transfer_out_wallet` is absent on purpose: that money leaves the
 * tracked accounts.
 */
export const isInternalTransfer = (nature: TRANSACTION_TRANSFER_NATURE | undefined | null): boolean =>
  isTwoLegTransfer(nature) ||
  nature === TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio ||
  nature === TRANSACTION_TRANSFER_NATURE.transfer_to_venture;

/**
 * One row per transfer: the income leg of a two-leg transfer is dropped when its
 * expense leg is in the same set, and kept when it is the only leg present
 * (e.g. a view scoped to the destination account).
 */
export const dedupeTransferLegs = <
  T extends {
    transferNature: TRANSACTION_TRANSFER_NATURE;
    transactionType: TRANSACTION_TYPES;
    transferId?: string | null;
  },
>(
  rows: T[],
): T[] => {
  const transferIdsWithExpense = new Set(
    rows
      .filter((row) => isTwoLegTransfer(row.transferNature) && row.transactionType === TRANSACTION_TYPES.expense)
      .map((row) => row.transferId),
  );

  return rows.filter(
    (row) =>
      !isTwoLegTransfer(row.transferNature) ||
      row.transactionType === TRANSACTION_TYPES.expense ||
      !transferIdsWithExpense.has(row.transferId),
  );
};

/**
 * Splits amounts on `transactionType`, never on the sign: amounts are stored positive.
 * Internal transfers stay out of income, expense and net, since only one leg of a pair
 * is ever counted and either side would book a full-value amount that never happened.
 * Unit-agnostic: the result is in whatever unit `refAmount` carries.
 */
export const sumTransactionTotals = (
  rows: { transferNature: TRANSACTION_TRANSFER_NATURE; transactionType: TRANSACTION_TYPES; refAmount: number }[],
) => {
  let income = 0;
  let expense = 0;
  let transfers = 0;

  for (const row of rows) {
    if (isInternalTransfer(row.transferNature)) transfers += row.refAmount;
    else if (row.transactionType === TRANSACTION_TYPES.income) income += row.refAmount;
    else expense += row.refAmount;
  }

  return { income, expense, net: income - expense, transfers };
};
