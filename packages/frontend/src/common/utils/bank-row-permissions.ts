import { ACCOUNT_TYPES, type AccountModel, type TransactionModel } from '@bt/shared/types';
import { format, isBefore, min, startOfDay } from 'date-fns';

type BankRow = Pick<TransactionModel, 'accountType' | 'time'> & Partial<Pick<TransactionModel, 'isPlanned'>>;
type BankRowAccount = Pick<AccountModel, 'type' | 'bankSeamAt'>;
type BankRowPermissions = { canEditLockedFields: boolean; canDelete: boolean };

const OPEN: BankRowPermissions = { canEditLockedFields: true, canDelete: true };
const LOCKED: BankRowPermissions = { canEditLockedFields: false, canDelete: false };

export const isBankAccount = ({ account }: { account: Pick<AccountModel, 'type'> }): boolean =>
  !!account.type && account.type !== ACCOUNT_TYPES.system;

/** An unknown account (a shared tracker's row) counts as manual only when the row says `system`. */
export const isOnBankAccount = ({
  transaction,
  account,
}: {
  transaction: Pick<TransactionModel, 'accountType'>;
  account: Pick<AccountModel, 'type'> | undefined;
}): boolean => (account ? isBankAccount({ account }) : transaction.accountType !== ACCOUNT_TYPES.system);

/**
 * Amount, date, type and delete locks for a row. A planned row is never locked. On a bank-linked account only
 * manual rows dated strictly before `bankSeamAt` unlock.
 */
export const getBankRowPermissions = ({
  transaction,
  account,
}: {
  transaction: BankRow;
  account: BankRowAccount | undefined;
}): BankRowPermissions => {
  if (transaction.isPlanned) return OPEN;
  if (!isOnBankAccount({ transaction, account })) return OPEN;
  if (!account?.bankSeamAt || transaction.accountType !== ACCOUNT_TYPES.system) return LOCKED;

  return isBefore(new Date(transaction.time), new Date(account.bankSeamAt)) ? OPEN : LOCKED;
};

/** A leg whose amount, date and type the bank owns. */
export const isBankLockedLeg = ({
  transaction,
  account,
}: {
  transaction: BankRow | undefined;
  account: BankRowAccount | undefined;
}): boolean => !!transaction && !getBankRowPermissions({ transaction, account }).canEditLockedFields;

/**
 * The instant the legs' shared date must stay strictly before: the earliest seam among pre-seam manual legs.
 * Undefined when no leg is capped, or when a bank-locked leg keeps the date from changing at all.
 */
export const getBankSeamCutoff = ({
  legs,
}: {
  legs: { transaction: BankRow | undefined; account: BankRowAccount | undefined }[];
}): Date | undefined => {
  if (legs.some((leg) => isBankLockedLeg(leg))) return undefined;
  const seams = legs.flatMap(({ transaction, account }) =>
    transaction && !transaction.isPlanned && account?.bankSeamAt && isBankAccount({ account })
      ? [new Date(account.bankSeamAt)]
      : [],
  );
  return seams.length ? min(seams) : undefined;
};

/** The seam in the viewer's local time: the day, plus the time when the seam isn't at local midnight. */
export const formatBankSeamDay = ({ seamAt }: { seamAt: Date | string }): string => {
  const date = new Date(seamAt);
  return format(date, startOfDay(date).getTime() === date.getTime() ? 'dd MMM yyyy' : 'dd MMM yyyy, HH:mm');
};
