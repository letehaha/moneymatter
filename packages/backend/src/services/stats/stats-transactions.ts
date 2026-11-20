import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import Accounts from '@models/accounts.model';
import { AccessPolicy, PlannedPolicy, findTransactions } from '@models/transactions-query';
import Transactions from '@models/transactions.model';
import { endOfDay } from 'date-fns';
import { FindAttributeOptions, Includeable, Op, Order, WhereOptions, literal } from 'sequelize';

import { CategoryRefundPair, resolveRefundPairs } from './category-allocation';

/**
 * What counts as money movement for reporting, for the reports that aggregate transaction rows
 * over a window (cash-flow, expenses history, cumulative, pivot, savings, tracker spend). Reports
 * that read something other than those rows — earliest date, vehicle anchors, refund pair
 * resolution — go to the boundary directly.
 *
 * Baked in, not negotiable per call site: transfer legs are out (they move money between the
 * user's own accounts), accounts flagged `excludeFromStats` are out (INNER JOIN), and
 * balance-adjustment rows are out. The one transfer that stays is the cash leg of a loan
 * payment: money leaving the user's pocket to service debt is spend to them, even though the
 * paired income leg on the loan account is only a liability reduction and never counts.
 * `transfers: 'include'` lifts the transfer exclusion for reports where the user explicitly opts in.
 */
type StatsRefundsPolicy =
  | 'net' // caller nets refunds itself: rows come back with their refund pairs resolved
  | 'exclude-refund-rows' // refund-linked rows never enter the aggregation
  | 'ignore'; // refunds are counted like any other row

interface StatsWindow {
  /** `yyyy-MM-dd` (start of that day) or an exact Date bound. Omit for an open start. */
  from?: string | Date;
  /**
   * `yyyy-MM-dd` or an exact Date bound. Omit for an open end. A day string covers the whole day
   * only when it closes a range — see `windowWhere`.
   */
  to?: string | Date;
}

type StatsRefundsOptions =
  | { refunds: Exclude<StatsRefundsPolicy, 'net'> }
  /** `decimals` of the base currency: the scale the resolved pairs' minor units are at. */
  | { refunds: 'net'; decimals: number };

type StatsTransactionsOptions = StatsRefundsOptions & {
  access: AccessPolicy;
  planned: PlannedPolicy;
  transfers?: 'exclude' | 'include';
  window: StatsWindow;
  where?: WhereOptions;
  attributes?: FindAttributeOptions;
  include?: Includeable[];
  order?: Order;
};

export interface StatsTransactionsResult {
  rows: Transactions[];
  /**
   * Refund pairs touching `rows`, oriented into expense/income sides. Empty unless
   * `refunds: 'net'`. Reports keyed on payee/tag (pivot) or on original/refund orientation
   * (trackers) resolve their own pairs — those shapes carry data a category pair cannot express.
   */
  refundPairs: CategoryRefundPair[];
}

export const moneyMovementWhere: WhereOptions = {
  [Op.or]: [
    { transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer },
    { transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan, transactionType: TRANSACTION_TYPES.expense },
  ],
};

/**
 * Drops a row when any live member of its refund group is flagged. Each check correlates on an
 * indexed column; a single IN/UNION form plans as an anti join over every flagged row DB-wide.
 */
export const excludeFromStatsSql = ({ alias = '"Transactions"' }: { alias?: string } = {}): string => `(
  ${alias}."excludeFromStats" = false
  AND NOT EXISTS (
    SELECT 1 FROM "RefundTransactions" r
    JOIN "Transactions" g ON g."id" = r."originalTxId"
    WHERE r."refundTxId" = ${alias}."id" AND g."excludeFromStats" AND g."deletedAt" IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM "RefundTransactions" r
    JOIN "Transactions" g ON g."id" = r."refundTxId"
    WHERE r."originalTxId" = ${alias}."id" AND g."excludeFromStats" AND g."deletedAt" IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM "RefundTransactions" own
    JOIN "RefundTransactions" sib ON sib."originalTxId" = own."originalTxId"
    JOIN "Transactions" g ON g."id" = sib."refundTxId"
    WHERE own."refundTxId" = ${alias}."id" AND g."excludeFromStats" AND g."deletedAt" IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM "RefundTransactions" own
    JOIN "RefundTransactions" sib ON sib."refundTxId" = own."refundTxId"
    JOIN "Transactions" g ON g."id" = sib."originalTxId"
    WHERE own."originalTxId" = ${alias}."id" AND g."excludeFromStats" AND g."deletedAt" IS NULL
  )
)`;

export const excludeFromStatsWhere: WhereOptions = literal(excludeFromStatsSql());

/**
 * A `to` day string is stretched to end-of-day only when `from` bounds the other side; an
 * open-start window stops at that day's midnight. Odd, but it is the boundary every stats report
 * was written and tested against, so widening it here would silently move report totals.
 */
const windowWhere = ({ window }: { window: StatsWindow }): WhereOptions | null => {
  if (!window.from && !window.to) return null;

  const bounds: { [Op.gte]?: Date; [Op.lte]?: Date } = {};

  if (window.from) bounds[Op.gte] = new Date(window.from);

  if (window.to) {
    const closesRange = typeof window.to === 'string' && Boolean(window.from);
    bounds[Op.lte] = closesRange ? endOfDay(new Date(window.to)) : new Date(window.to);
  }

  return { time: bounds };
};

/**
 * `refunds: 'net'` needs the projection to carry `id`, `amount`, `refAmount`, `categoryId`,
 * `transactionType`, `time` and `refundLinked` — the pair resolver reads them off the rows.
 */
export const statsTransactions = async (options: StatsTransactionsOptions): Promise<StatsTransactionsResult> => {
  const { access, planned, refunds, transfers = 'exclude', window, where, attributes, include = [], order } = options;
  // Op.and rather than a merged object: a caller's own `time` clause or Op.or must never
  // overwrite (or be overwritten by) the window and refund fragments.
  const timeWhere = windowWhere({ window });
  const fragments: WhereOptions[] = [
    ...(timeWhere ? [timeWhere] : []),
    ...(refunds === 'exclude-refund-rows' ? [{ refundLinked: false }] : []),
    ...(where ? [where] : []),
    ...(transfers === 'exclude' ? [moneyMovementWhere] : []),
    excludeFromStatsWhere,
  ];

  const rows = await findTransactions({
    access,
    planned,
    balanceAdjustments: 'exclude',
    completeness: 'all',
    where: { [Op.and]: fragments },
    include: [{ model: Accounts, where: { excludeFromStats: false }, attributes: [] }, ...include],
    ...(attributes ? { attributes } : {}),
    ...(order ? { order } : {}),
  });

  return {
    rows,
    refundPairs:
      options.refunds === 'net' && rows.length > 0
        ? await resolveRefundPairs({ transactions: rows, decimals: options.decimals })
        : [],
  };
};
