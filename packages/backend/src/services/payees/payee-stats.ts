import { Money } from '@common/types/money';
import Accounts from '@models/accounts.model';
import { FindTransactionsOptions, findTransactions } from '@models/transactions-query';
import { Op, col, fn, literal } from 'sequelize';

export interface PayeeStatsRow {
  payeeId: string;
  transactionCount: number;
  netFlowRef: Money;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  topCategoryId: string | null;
}

/** COUNT lands as a number (the INT8 parser in `models/index`), SUM over DECIMAL as an exact numeric string. */
interface TotalsRow {
  payeeId: string;
  transactionCount: number;
  netFlowRef: string | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

interface CategoryCountRow {
  payeeId: string;
  categoryId: string;
  transactionCount: number;
}

const signedRefAmountSum = literal(
  `SUM(CASE WHEN "Transactions"."transactionType" = 'expense' THEN -"Transactions"."refAmount" ELSE "Transactions"."refAmount" END)`,
);

const rowCount = fn('COUNT', col('Transactions.id'));

type CountableScope = Pick<
  FindTransactionsOptions,
  'access' | 'planned' | 'transfers' | 'balanceAdjustments' | 'completeness' | 'include' | 'raw'
>;

/**
 * What a Payee's stats count: real money the user moved with that Payee. Transfer legs keep
 * their `payeeId` (a transfer can be reverted), plans record an intention rather than a
 * payment, balance adjustments are the account's own correction rather than a payment, and
 * accounts flagged `excludeFromStats` are out of every report.
 */
const countableScope = ({ userId }: { userId: number }): CountableScope => ({
  access: { creator: userId },
  planned: 'exclude',
  transfers: 'exclude',
  balanceAdjustments: 'exclude',
  completeness: 'all',
  include: [{ model: Accounts, where: { excludeFromStats: false }, attributes: [] }],
  raw: true,
});

/**
 * Computes per-Payee stats:
 *   - transaction count
 *   - net flow in ref currency (signed: income positive, expense negative)
 *   - first / last seen timestamps
 *   - the single most-frequent category id ("top category")
 *
 * Aggregated in the database off the `(userId, payeeId, time DESC)` index; there are no
 * denormalized counters to keep in sync. Ties on the top category resolve to the lowest
 * category id so the answer is stable across calls.
 *
 * When `payeeIds` is empty, returns `[]` without hitting the DB.
 */
async function getPayeeStats({
  userId,
  payeeIds,
  accountId,
}: {
  userId: number;
  payeeIds: string[];
  accountId?: string;
}): Promise<PayeeStatsRow[]> {
  if (payeeIds.length === 0) return [];

  const scope = countableScope({ userId });
  const payeeFilter = { payeeId: { [Op.in]: payeeIds }, ...(accountId !== undefined ? { accountId } : {}) };

  const [totals, categoryCounts] = (await Promise.all([
    findTransactions({
      ...scope,
      where: payeeFilter,
      attributes: [
        'payeeId',
        [rowCount, 'transactionCount'],
        [signedRefAmountSum, 'netFlowRef'],
        [fn('MIN', col('Transactions.time')), 'firstSeenAt'],
        [fn('MAX', col('Transactions.time')), 'lastSeenAt'],
      ],
      group: ['Transactions.payeeId'],
    }),
    findTransactions({
      ...scope,
      where: { ...payeeFilter, categoryId: { [Op.ne]: null } },
      attributes: ['payeeId', 'categoryId', [rowCount, 'transactionCount']],
      group: ['Transactions.payeeId', 'Transactions.categoryId'],
    }),
  ])) as unknown as [TotalsRow[], CategoryCountRow[]];

  const topCategoryByPayee = new Map<string, { categoryId: string; count: number }>();
  for (const row of categoryCounts) {
    const count = row.transactionCount;
    const best = topCategoryByPayee.get(row.payeeId);

    if (!best || count > best.count || (count === best.count && row.categoryId < best.categoryId)) {
      topCategoryByPayee.set(row.payeeId, { categoryId: row.categoryId, count });
    }
  }

  return totals.map((row) => ({
    payeeId: row.payeeId,
    transactionCount: row.transactionCount,
    netFlowRef: Money.fromDecimal(row.netFlowRef ?? 0),
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    topCategoryId: topCategoryByPayee.get(row.payeeId)?.categoryId ?? null,
  }));
}

/**
 * Compact map keyed by `payeeId` for joining stats onto a list of Payees in a
 * single pass without N+1 lookups.
 */
export async function getPayeeStatsMap({
  userId,
  payeeIds,
  accountId,
}: {
  userId: number;
  payeeIds: string[];
  accountId?: string;
}): Promise<Map<string, PayeeStatsRow>> {
  const rows = await getPayeeStats({ userId, payeeIds, accountId });
  const map = new Map<string, PayeeStatsRow>();
  for (const row of rows) map.set(row.payeeId, row);
  return map;
}
