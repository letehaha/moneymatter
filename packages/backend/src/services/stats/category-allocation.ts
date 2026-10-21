import { TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import RefundTransactions from '@models/refund-transactions.model';
import TransactionSplits from '@models/transaction-splits.model';
import { findTransactions } from '@models/transactions-query';
import { Op } from 'sequelize';

/**
 * The category allocation engine shared by the spendings-by-categories, pivot and cash-flow reports.
 *
 * Given a set of transactions it produces a flat list of signed, date-stamped contributions to
 * categories:
 *
 * - Split transactions distribute across their categories — the primary category gets
 *   `tx.refAmount − Σ splits` (only when positive), each split its own `split.refAmount`.
 * - Refunds net cash-basis: a refund emits a negative leg at the refunded category, stamped with
 *   the *refund tx's* own date (so it lands in the bucket the money came back in). The refunded
 *   category is the targeted split's category, else the original expense's category.
 *
 * The engine stays grouping-agnostic: legs are keyed by the exact `categoryId` (null = the
 * uncategorized residual) and carry their transaction's type, so a report that shows income and
 * expenses side by side can sort them out from a single call. Each consumer maps a leg to its own
 * grouping key (root category, selected ancestor, exact subcategory) and decides whether to keep
 * the time axis.
 *
 * Refund legs are returned separately so a consumer can drop a refund whose category never received
 * any base spend in range (avoids phantom negative rows for out-of-range originals). A consumer
 * that needs both sides of a refund calls `resolveRefundPairs` directly.
 */

/** Minimal transaction shape the engine needs; both stats consumers already load these columns. */
interface AllocatableTransaction {
  id: string;
  refAmount: Money;
  categoryId: string | null;
  transactionType: TRANSACTION_TYPES;
  time: Date | string;
  refundLinked: boolean;
}

/** One signed contribution to a category, stamped with the date it should be attributed to. */
export interface CategoryAllocationLeg {
  /** Exact category id, or null for the uncategorized residual. */
  categoryId: string | null;
  /** Base legs are positive; refund legs are negative. Integer minor units of the base currency. */
  minor: number;
  /** Base legs use the transaction's own date; refund legs use the refund tx's date. */
  time: Date;
  /** Type of the transaction this leg came from; a split leg inherits its parent transaction's. */
  transactionType: TRANSACTION_TYPES;
}

export interface CategoryAllocations {
  /** Positive spend, one leg per (primary/split) contribution. */
  base: CategoryAllocationLeg[];
  /** Negative refund adjustments; empty when `applyRefunds` is false or nothing is refunded. */
  refunds: CategoryAllocationLeg[];
}

/**
 * A refund pair resolved to the category each side of a report should net against.
 *
 * A refund always pairs one expense with one income (`createSingleRefund` rejects same-type pairs),
 * so both sides are named: an expense report nets against `expenseCategoryId`, an income report
 * against `incomeCategoryId`. A report that shows both sides (cash flow) subtracts `minor` from
 * each of them in the same bucket, which leaves its net flow untouched.
 *
 * When the refund targets a split, that split belongs to the *original* transaction, so its
 * category replaces the original's on whichever of the two sides the original sits.
 *
 * The `…InScope` flags say whether that side's transaction was in the set handed to
 * `resolveRefundPairs`. A side that was only fetched to resolve the pair contributed no positive
 * amount to the caller's report, so netting against it would invent money.
 *
 * Two siblings resolve refunds for other reports and stay separate on purpose: trackers'
 * `TrackerRefundPair` keys its scope flags on original/refund rather than expense/income, and the
 * pivot's `WholeTxRefund` carries payee/tag, which splits don't have.
 */
export interface CategoryRefundPair {
  /** Refund magnitude in integer minor units of the base currency, always positive: callers negate it. */
  minor: number;
  /** The refund tx's own date — the bucket the money actually moved in. */
  time: Date;
  expenseCategoryId: string | null;
  incomeCategoryId: string | null;
  expenseInScope: boolean;
  incomeInScope: boolean;
}

interface TxEntry {
  refAmount: Money;
  categoryId: string | null;
  transactionType: TRANSACTION_TYPES;
  time: Date;
}

const toTxEntry = (tx: {
  refAmount: Money;
  categoryId: string | null;
  transactionType: TRANSACTION_TYPES;
  time: Date | string;
}): TxEntry => ({
  refAmount: tx.refAmount,
  categoryId: tx.categoryId,
  transactionType: tx.transactionType,
  time: new Date(tx.time),
});

/**
 * Resolves every refund touching `transactions` into a pair of categories plus the magnitude and
 * date of the money that came back. A pair surfaces as soon as *either* of its two transactions is
 * in the passed set, so a consumer holding both sides (cash flow) always sees the pair exactly once.
 *
 * Pairs whose counterpart transaction no longer exists are dropped rather than half-applied.
 */
export const resolveRefundPairs = async ({
  transactions,
  decimals,
}: {
  transactions: AllocatableTransaction[];
  /** Decimals of the base currency: the scale the pairs' minor units are at. */
  decimals: number;
}): Promise<CategoryRefundPair[]> => {
  const txIdsWithRefunds = transactions.filter((tx) => tx.refundLinked).map((tx) => tx.id);
  if (txIdsWithRefunds.length === 0) return [];

  const refunds = await RefundTransactions.findAll({
    where: {
      [Op.or]: [{ refundTxId: { [Op.in]: txIdsWithRefunds } }, { originalTxId: { [Op.in]: txIdsWithRefunds } }],
    },
  });
  if (refunds.length === 0) return [];

  const txMap = new Map<string, TxEntry>();
  for (const tx of transactions) txMap.set(tx.id, toTxEntry(tx));
  const inScopeTxIds = new Set(txMap.keys());

  // A refund's original/refund tx can sit outside the report window (e.g. bought last month,
  // refunded this month). Pull those in so the netting can resolve them.
  const missingTxIds = new Set<string>();
  const splitIdsToFetch = new Set<string>();
  for (const refund of refunds) {
    if (refund.originalTxId && !txMap.has(refund.originalTxId)) missingTxIds.add(refund.originalTxId);
    if (!txMap.has(refund.refundTxId)) missingTxIds.add(refund.refundTxId);
    if (refund.splitId) splitIdsToFetch.add(refund.splitId);
  }

  if (missingTxIds.size > 0) {
    // A refund link and both of its transactions always belong to one user, so scoping the
    // counterpart lookup to the links' owners keeps it inside the scope the caller's rows came
    // from. Planned rows never count as a refund leg — stats read money that actually moved.
    // Balance adjustments stay in: this hydrates counterparts of links the caller already has,
    // and dropping one would leave its pair half-resolved rather than filtered.
    const missingTxs = await findTransactions({
      planned: 'exclude',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      completeness: 'all',
      where: {
        id: { [Op.in]: [...missingTxIds] },
        userId: { [Op.in]: [...new Set(refunds.map((refund) => refund.userId))] },
      },
      attributes: ['id', 'refAmount', 'categoryId', 'transactionType', 'time'],
    });
    for (const tx of missingTxs) txMap.set(tx.id, toTxEntry(tx));
  }

  const splitCategoryById = new Map<string, string | null>();
  if (splitIdsToFetch.size > 0) {
    const targetSplits = await TransactionSplits.findAll({
      where: { id: { [Op.in]: [...splitIdsToFetch] } },
      attributes: ['id', 'categoryId'],
    });
    for (const split of targetSplits) splitCategoryById.set(split.id, split.categoryId);
  }

  const pairs: CategoryRefundPair[] = [];
  for (const refund of refunds) {
    if (!refund.originalTxId) continue;
    const originalTx = txMap.get(refund.originalTxId);
    const refundTx = txMap.get(refund.refundTxId);
    if (!originalTx || !refundTx) continue;

    // `splitId` always points at a split of the original tx (enforced when the refund is created),
    // so the split's category stands in for the original's on whichever side the original sits.
    const splitCategoryId = refund.splitId ? splitCategoryById.get(refund.splitId) : undefined;
    const originalCategoryId = splitCategoryId !== undefined ? splitCategoryId : originalTx.categoryId;
    const originalIsExpense = originalTx.transactionType === TRANSACTION_TYPES.expense;
    const originalInScope = inScopeTxIds.has(refund.originalTxId);
    const refundInScope = inScopeTxIds.has(refund.refundTxId);

    pairs.push({
      minor: refundTx.refAmount.toMinorUnits({ decimals }),
      time: refundTx.time,
      expenseCategoryId: originalIsExpense ? originalCategoryId : refundTx.categoryId,
      incomeCategoryId: originalIsExpense ? refundTx.categoryId : originalCategoryId,
      expenseInScope: originalIsExpense ? originalInScope : refundInScope,
      incomeInScope: originalIsExpense ? refundInScope : originalInScope,
    });
  }

  return pairs;
};

export const computeCategoryAllocations = async ({
  transactions,
  applyRefunds,
  decimals,
  refundSide = TRANSACTION_TYPES.expense,
}: {
  transactions: AllocatableTransaction[];
  applyRefunds: boolean;
  /** Decimals of the base currency: the scale the legs' minor units are at. */
  decimals: number;
  /** Which side of each refund pair the negative legs net against, so a refund never shows up as income. */
  refundSide?: TRANSACTION_TYPES;
}): Promise<CategoryAllocations> => {
  if (transactions.length === 0) return { base: [], refunds: [] };

  const txIds = transactions.map((tx) => tx.id);

  const [splits, refundPairs] = await Promise.all([
    TransactionSplits.findAll({
      where: { transactionId: { [Op.in]: txIds } },
      attributes: ['id', 'transactionId', 'categoryId', 'refAmount'],
    }),
    applyRefunds ? resolveRefundPairs({ transactions, decimals }) : Promise.resolve<CategoryRefundPair[]>([]),
  ]);

  const splitsByTxId = new Map<string, TransactionSplits[]>();
  for (const split of splits) {
    const existing = splitsByTxId.get(split.transactionId) ?? [];
    existing.push(split);
    splitsByTxId.set(split.transactionId, existing);
  }

  const base: CategoryAllocationLeg[] = [];
  for (const tx of transactions) {
    const time = new Date(tx.time);
    const transactionType = tx.transactionType;
    const txSplits = splitsByTxId.get(tx.id);
    if (txSplits && txSplits.length > 0) {
      const splitsTotal = txSplits.reduce((sum, split) => sum + split.refAmount.toMinorUnits({ decimals }), 0);
      const primaryAmount = tx.refAmount.toMinorUnits({ decimals }) - splitsTotal;
      if (primaryAmount > 0) base.push({ categoryId: tx.categoryId, minor: primaryAmount, time, transactionType });
      for (const split of txSplits) {
        base.push({
          categoryId: split.categoryId,
          minor: split.refAmount.toMinorUnits({ decimals }),
          time,
          transactionType,
        });
      }
    } else {
      base.push({ categoryId: tx.categoryId, minor: tx.refAmount.toMinorUnits({ decimals }), time, transactionType });
    }
  }

  const refundLegs: CategoryAllocationLeg[] = refundPairs.map((pair) => ({
    categoryId: refundSide === TRANSACTION_TYPES.income ? pair.incomeCategoryId : pair.expenseCategoryId,
    minor: -pair.minor,
    time: pair.time,
    transactionType: refundSide,
  }));

  return { base, refunds: refundLegs };
};
