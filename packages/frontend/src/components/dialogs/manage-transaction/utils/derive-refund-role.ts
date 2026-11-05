import type { RefundRole } from '@/api/transactions';
import { TRANSACTION_TYPES, TransactionModel } from '@bt/shared/types';
import { isAfter, isBefore, startOfDay } from 'date-fns';

import type { RefundWithSplit } from '../types';

type RowLike = Pick<TransactionModel, 'time' | 'transactionType'>;

export const isDatedAfterPivotDay = ({ rowTime, currentTime }: { rowTime: Date | string; currentTime: Date }) =>
  isAfter(startOfDay(new Date(rowTime)), startOfDay(currentTime));

/** Earlier row is the original; later row is the refund; same local day: the expense is the original. */
export const deriveRowRefundRole = ({ row, currentTime }: { row: RowLike; currentTime: Date }): RefundRole => {
  const rowDay = startOfDay(new Date(row.time));
  const currentDay = startOfDay(currentTime);
  if (isBefore(rowDay, currentDay)) return 'refund';
  if (isAfter(rowDay, currentDay)) return 'original';
  return row.transactionType === TRANSACTION_TYPES.expense ? 'refund' : 'original';
};

/**
 * Role of the current entry for the whole ticked set. Saved links and creation fix it; otherwise the
 * first ticked row decides by date and later ticks join. Saved links never get re-derived from dates:
 * a re-dated or legacy link would otherwise flip side on save and its share would cross currencies.
 */
export const deriveRefundRole = ({
  savedRefunds,
  savedRefundedBy,
  hasExternalLink,
  isRecordCreation,
  firstTicked,
  currentTime,
}: {
  savedRefunds: RefundWithSplit[] | null | undefined;
  savedRefundedBy: RefundWithSplit[] | null | undefined;
  hasExternalLink?: boolean;
  isRecordCreation: boolean;
  firstTicked: RowLike | null | undefined;
  currentTime: Date;
}): RefundRole | null => {
  if (savedRefunds?.length || hasExternalLink) return 'refund';
  if (savedRefundedBy?.length) return 'original';
  if (isRecordCreation) return 'refund';
  if (!firstTicked) return null;
  return deriveRowRefundRole({ row: firstTicked, currentTime });
};
