import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { StatsTransactionsResult, statsTransactions } from '@services/stats/stats-transactions';
import { Op } from 'sequelize';

/**
 * Real income and expense transactions that make up the "savings intake": every transfer
 * leg is out, loan payments included (including the balance adjustments
 * that carry an income/expense type but move no real money), accounts flagged
 * `excludeFromStats` are left out, and refund pairs come back resolved so both sides
 * of a refund can be netted.
 *
 * Shared by the net-worth-drivers and investment-contributions reports so both read
 * the exact same transaction set. `refAmount` keeps its Money getter (no `raw`), so
 * callers convert it to minor units at `decimals`.
 */
export const fetchSavingsTransactions = ({
  userId,
  from,
  to,
  decimals,
}: {
  userId: number;
  from: string;
  to: string;
  /** Decimals of the base currency: the scale refund pairs are resolved in. */
  decimals: number;
}): Promise<StatsTransactionsResult> =>
  statsTransactions({
    // `{ creator }`, not `{ accessibleTo }`: both consumers are personal surfaces — the
    // "share of savings" card, whose numerator is owner-only `PortfolioTransfers`, and the
    // net-worth drivers' savings intake. Widening this alone would move the denominator
    // without the numerator.
    access: { creator: userId },
    planned: 'exclude',
    refunds: 'net',
    decimals,
    window: { from, to },
    // A loan payment moves cash into an equal liability drop, so it is not savings intake even
    // though spending reports count its cash leg as an expense.
    where: {
      transactionType: { [Op.in]: [TRANSACTION_TYPES.income, TRANSACTION_TYPES.expense] },
      transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
    },
    attributes: ['id', 'time', 'refAmount', 'transactionType', 'categoryId', 'refundLinked'],
  });
