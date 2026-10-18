/**
 * MCP-specific slimming over the REST serializer output.
 *
 * The REST serializers (`serializeAccounts`, `serializeTransactions`) carry
 * fields the frontend needs — ACL/share context, UI hints, audit timestamps,
 * near-always-zero fee fields. For an AI client over MCP those are wasted context
 * tokens. These helpers take the already-serialized, already-decimal output and keep only the
 * fields an assistant reasons about. The shared serializers stay untouched.
 */
import { goalDisplayStatus, toGoalCurrency } from '@bt/shared/goals/goal-math';
import type { AccountGroupApiResponse, GoalInsights, GoalModel, RecordId } from '@bt/shared/types';
import { INVESTMENT_DECIMAL_SCALE } from '@common/types/money';
import type Accounts from '@models/accounts.model';
import type Categories from '@models/categories.model';
import type PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import type SubscriptionTransactions from '@models/subscription-transactions.model';
import type Subscriptions from '@models/subscriptions.model';
import type { TransactionsAttributes } from '@models/transactions.model';
import type { AccountApiResponse } from '@root/serializers/accounts.serializer';
import type { TransactionApiResponse } from '@root/serializers/transactions.serializer';

export function slimAccountsForMcp(accounts: AccountApiResponse[]) {
  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    accountCategory: a.accountCategory,
    currencyCode: a.currencyCode,
    currentBalance: a.currentBalance,
    refCurrentBalance: a.refCurrentBalance,
    creditLimit: a.creditLimit,
    refCreditLimit: a.refCreditLimit,
    status: a.status,
    excludeFromStats: a.excludeFromStats,
  }));
}

/**
 * The detail view of one account: the list fields plus what a single-account read, a write
 * result or a bank unlink needs (opening balance, bank link, logo, currency precision, share).
 */
export function slimAccountDetailForMcp(account: AccountApiResponse) {
  const [slim] = slimAccountsForMcp([account]);
  return {
    ...slim,
    initialBalance: account.initialBalance,
    refInitialBalance: account.refInitialBalance,
    bankDataProviderConnectionId: account.bankDataProviderConnectionId,
    bankProviderType: account.bankProviderType,
    needsRelink: account.needsRelink,
    logoDomain: account.logoDomain,
    logoInitials: account.logoInitials,
    logoColor: account.logoColor,
    currencyMeta: account.currencyMeta,
    share: account.share,
  };
}

/** One account group without its accounts, children or path: what a write result needs. */
export function slimAccountGroupForMcp(group: AccountGroupApiResponse) {
  return {
    id: group.id,
    name: group.name,
    parentGroupId: group.parentGroupId,
    bankDataProviderConnectionId: group.bankDataProviderConnectionId,
    logoDomain: group.logoDomain,
    logoInitials: group.logoInitials,
    logoColor: group.logoColor,
  };
}

const GROUP_PATH_SEPARATOR = ' > ';
const GROUP_PATH_TRUNCATED = '…';

/**
 * The groups come as a flat list in which a child also appears nested one level inside its
 * parent. Each entry keeps `parentGroupId` and gets a `path` of group names from the top,
 * built from the list itself. An ancestor missing from the list (an account filter drops
 * groups with no matching account) starts the path with "…" instead of passing for the top.
 */
export function slimAccountGroupsForMcp(groups: AccountGroupApiResponse[]) {
  const byId = new Map(groups.map((group) => [group.id, group]));

  const pathOf = (group: AccountGroupApiResponse): string => {
    const names = [group.name];
    const seen = new Set([group.id]);
    let parentId = group.parentGroupId;
    let truncated = false;

    while (parentId) {
      const parent = byId.get(parentId);
      if (!parent || seen.has(parent.id)) {
        truncated = true;
        break;
      }
      seen.add(parent.id);
      names.unshift(parent.name);
      parentId = parent.parentGroupId;
    }

    return (truncated ? [GROUP_PATH_TRUNCATED, ...names] : names).join(GROUP_PATH_SEPARATOR);
  };

  return groups.map((group) => ({
    ...slimAccountGroupForMcp(group),
    path: pathOf(group),
    childGroups: group.childGroups.map((child) => ({ id: child.id, name: child.name })),
    accounts: slimAccountsForMcp(group.accounts),
  }));
}

export function slimPortfolioTransferForMcp(transfer: PortfolioTransfers) {
  return {
    id: transfer.id,
    date: transfer.date,
    amount: transfer.amount.toDecimalString(INVESTMENT_DECIMAL_SCALE),
    refAmount: transfer.refAmount.toDecimalString(INVESTMENT_DECIMAL_SCALE),
    currencyCode: transfer.currencyCode,
    description: transfer.description,
    isAdjustment: transfer.isAdjustment,
    affectsCash: transfer.affectsCash,
    transactionId: transfer.transactionId,
    fromAccountId: transfer.fromAccountId,
    toAccountId: transfer.toAccountId,
    fromPortfolioId: transfer.fromPortfolioId,
    toPortfolioId: transfer.toPortfolioId,
    ...(transfer.fromPortfolio && {
      fromPortfolio: { id: transfer.fromPortfolio.id, name: transfer.fromPortfolio.name },
    }),
    ...(transfer.toPortfolio && { toPortfolio: { id: transfer.toPortfolio.id, name: transfer.toPortfolio.name } }),
    ...(transfer.fromAccount && { fromAccount: { id: transfer.fromAccount.id, name: transfer.fromAccount.name } }),
    ...(transfer.toAccount && { toAccount: { id: transfer.toAccount.id, name: transfer.toAccount.name } }),
    ...(transfer.toCurrencyCode && {
      toCurrencyCode: transfer.toCurrencyCode,
      toAmount: transfer.toAmount?.toDecimalString(INVESTMENT_DECIMAL_SCALE) ?? null,
    }),
  };
}

/**
 * A transaction as an assistant reads it. `payeeNames` maps the caller's payee ids to names
 * (`getPayeeNames`); a transaction with no payee, or one whose payee is not the caller's, gets
 * `payee: null`. It is required so no tool serializes a transaction without its payee.
 */
export function slimTransactionsForMcp({
  transactions,
  payeeNames,
}: {
  transactions: TransactionApiResponse[];
  payeeNames: ReadonlyMap<string, string>;
}) {
  return transactions.map((tx) => {
    const payeeName = tx.payeeId ? payeeNames.get(tx.payeeId) : undefined;

    return {
      id: tx.id,
      time: tx.time,
      amount: tx.amount,
      refAmount: tx.refAmount,
      currencyCode: tx.currencyCode,
      note: tx.note,
      transactionType: tx.transactionType,
      transferNature: tx.transferNature,
      accountId: tx.accountId,
      categoryId: tx.categoryId,
      isPlanned: tx.isPlanned,
      payeeId: tx.payeeId,
      payee: tx.payeeId && payeeName !== undefined ? { id: tx.payeeId, name: payeeName } : null,
      ...(tx.tags && { tags: tx.tags.map((t) => ({ id: t.id, name: t.name })) }),
      ...(tx.splits && {
        splits: tx.splits.map((s) => ({ categoryId: s.categoryId, amount: s.amount, note: s.note })),
      }),
      ...(tx.transactionGroups && { transactionGroups: tx.transactionGroups }),
    };
  });
}

/**
 * Shape of a `getSubscriptionById` result, narrowed to the fields the MCP slimmer
 * reads. Scalar fields are picked straight from the models so the types track the
 * schema; only the values the service transforms are overridden — `expectedAmount`
 * /`amount`/`refAmount` (Money → decimal number), the trimmed `account`/`category`
 * associations, and the computed `nextExpectedDate`. The service returns a loosely
 * typed `toJSON()` blob, so the tool casts into this before slimming.
 */
export type SubscriptionDetailForMcp = Pick<
  Subscriptions,
  | 'id'
  | 'name'
  | 'type'
  | 'frequency'
  | 'startDate'
  | 'endDate'
  | 'isActive'
  | 'notes'
  | 'expectedCurrencyCode'
  | 'transactionType'
> & {
  expectedAmount: number | null;
  nextExpectedDate: Date | string | null;
  account?: Pick<Accounts, 'id' | 'name' | 'currencyCode'> | null;
  category?: Pick<Categories, 'id' | 'name'> | null;
  transactions?: Array<
    Pick<
      TransactionsAttributes,
      'id' | 'time' | 'currencyCode' | 'note' | 'transactionType' | 'categoryId' | 'accountId'
    > & {
      amount: number;
      refAmount: number;
      SubscriptionTransactions?: Pick<SubscriptionTransactions, 'matchSource' | 'matchedAt'> | null;
    }
  > | null;
};

export function slimSubscriptionDetailForMcp(sub: SubscriptionDetailForMcp) {
  return {
    id: sub.id,
    name: sub.name,
    type: sub.type,
    transactionType: sub.transactionType,
    expectedAmount: sub.expectedAmount,
    expectedCurrencyCode: sub.expectedCurrencyCode,
    frequency: sub.frequency,
    startDate: sub.startDate,
    endDate: sub.endDate,
    isActive: sub.isActive,
    notes: sub.notes,
    nextExpectedDate: sub.nextExpectedDate,
    account: sub.account ?? null,
    category: sub.category ? { id: sub.category.id, name: sub.category.name } : null,
    // Embedded transactions arrive as full Transaction models; keep only what
    // confirms the link, plus the junction's match source/date.
    transactions: (sub.transactions ?? []).map((tx) => ({
      id: tx.id,
      time: tx.time,
      amount: tx.amount,
      refAmount: tx.refAmount,
      currencyCode: tx.currencyCode,
      note: tx.note,
      transactionType: tx.transactionType,
      categoryId: tx.categoryId,
      accountId: tx.accountId,
      matchSource: tx.SubscriptionTransactions?.matchSource ?? null,
      matchedAt: tx.SubscriptionTransactions?.matchedAt ?? null,
    })),
  };
}

const goalProgressForMcp = ({ goal, insights }: { goal: GoalModel; insights: GoalInsights }) => {
  const inGoalCurrency = (amount: number | null) => toGoalCurrency({ amount, rateToBase: insights.rateToBase });

  return {
    status: goalDisplayStatus(goal),
    currentValue: inGoalCurrency(insights.currentValue),
    remaining: inGoalCurrency(insights.remaining),
    pace: inGoalCurrency(insights.pace),
    historicalPace: inGoalCurrency(insights.historicalPace),
    neededMonthly: inGoalCurrency(insights.neededMonthly),
    etaMonths: insights.etaMonths,
    daysLeft: insights.daysLeft,
  };
};

/** Every amount is in the goal currency; the per-account history behind the insights is dropped. */
export function slimGoalsForMcp({ goals, accountNames }: { goals: GoalModel[]; accountNames: Map<RecordId, string> }) {
  return goals.map((goal) => ({
    id: goal.id,
    name: goal.name,
    status: goal.status,
    currencyCode: goal.currencyCode,
    targetAmount: goal.targetAmount,
    targetDate: goal.targetDate,
    plannedMonthly: goal.plannedMonthly,
    achievedAt: goal.achievedAt,
    achievedAmount: goal.achievedAmount,
    reachedHoldDays: goal.reachedHoldDays,
    progress: goal.insights ? goalProgressForMcp({ goal, insights: goal.insights }) : null,
    accounts: goal.accounts.map(({ accountId, sharePercent, fixedAmount, fixedPosition }) => ({
      accountId,
      accountName: accountNames.get(accountId) ?? null,
      sharePercent,
      fixedAmount,
      fixedPosition,
    })),
  }));
}
