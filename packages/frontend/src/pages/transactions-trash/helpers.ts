import { TRANSACTION_TYPES, type TransactionModel, type TrashEntry } from '@bt/shared/types';
import { differenceInMilliseconds } from 'date-fns';

const TRASH_EXPIRY_WARNING_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const getTrashDaysLeft = ({ expiresAt, now }: { expiresAt: string; now: Date }): number =>
  Math.max(0, Math.ceil(differenceInMilliseconds(new Date(expiresAt), now) / MS_PER_DAY));

export const isTrashExpiringSoon = ({ daysLeft }: { daysLeft: number }): boolean =>
  daysLeft <= TRASH_EXPIRY_WARNING_DAYS;

/** The leg the caller can see, which is the one whose id restore and delete take. */
export const getPrimaryTransaction = ({ entry }: { entry: TrashEntry }): TransactionModel =>
  entry.transactions.find((tx) => tx.id === entry.id) ?? entry.transactions[0]!;

export const getOtherLeg = ({ entry }: { entry: TrashEntry }): TransactionModel | null =>
  entry.transactions.find((tx) => tx.id !== getPrimaryTransaction({ entry }).id) ?? null;

export const getSignedAmount = ({ transaction }: { transaction: TransactionModel }): number =>
  transaction.transactionType === TRANSACTION_TYPES.expense ? -transaction.amount : transaction.amount;

/** Expiring entries for the banner, and the furthest of their deadlines so one sentence covers them all. */
export const getExpiringSummary = ({
  entries,
  now,
}: {
  entries: TrashEntry[];
  now: Date;
}): { count: number; withinDays: number } | null => {
  const soon = entries
    .map((entry) => getTrashDaysLeft({ expiresAt: entry.expiresAt, now }))
    .filter((daysLeft) => isTrashExpiringSoon({ daysLeft }));
  if (!soon.length) return null;
  return { count: soon.length, withinDays: Math.max(...soon) };
};
