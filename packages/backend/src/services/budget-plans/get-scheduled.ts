import { RecordId, SUBSCRIPTION_LINK_STATUS, TRANSACTION_TYPES } from '@bt/shared/types';
import { BudgetPlanScheduled, BudgetPlanScheduledItem } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { toUtcDateString } from '@common/utils/date';
import { t } from '@i18n/index';
import { ExchangeRateUnavailableError, NotFoundError } from '@js/errors';
import { logger } from '@js/utils/logger';
import Accounts from '@models/accounts.model';
import BudgetLineCategories from '@models/budget-line-categories.model';
import BudgetPlanAccounts from '@models/budget-plan-accounts.model';
import Payees from '@models/payees.model';
import SubscriptionTransactions from '@models/subscription-transactions.model';
import Subscriptions from '@models/subscriptions.model';
import { findTransactions } from '@models/transactions-query';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';
import { paymentDatesInRange, scheduleInclude } from '@services/subscriptions/get-upcoming-payments';
import { Op } from 'sequelize';

import { utcInstant } from './date-ranges';
import { findPlan } from './find-plan';
import { lineOwnerResolver, periodMembership } from './fold/fold-plan';
import { ensurePeriods, loadLines } from './periods/ensure-periods';
import { ownerCategories } from './validate-line-categories';

const EMPTY: BudgetPlanScheduled = {
  items: [],
  outflows: { total: 0, count: 0 },
  inflows: { total: 0, count: 0 },
  nextDate: null,
};

const signed = ({ amount, type }: { amount: Money; type: TRANSACTION_TYPES }): Money =>
  type === TRANSACTION_TYPES.expense ? amount.negate() : amount;

const totals = ({ items }: { items: BudgetPlanScheduledItem[] }) =>
  items.reduce((sum, item) => ({ total: sum.total.add(Money.fromDecimal(item.amount)), count: sum.count + 1 }), {
    total: Money.zero(),
    count: 0,
  });

/**
 * Subscription occurrences and planned transactions dated in the period, from
 * today on. A subscription counts when it is paid from an attached account, or
 * has no account and its category falls under a plan line.
 */
export const getScheduled = async ({
  userId,
  planId,
  periodId,
}: {
  userId: number;
  planId: RecordId;
  periodId: RecordId;
}): Promise<BudgetPlanScheduled> => {
  const plan = await findPlan({ planId, userId });

  const today = toUtcDateString(new Date());
  const period = (await ensurePeriods({ plan, today })).find((entry) => entry.id === periodId);
  if (!period) throw new NotFoundError({ message: t({ key: 'budgetPlans.periodNotFound' }) });

  const start = toUtcDateString(period.startDate);
  const until = toUtcDateString(period.endDate);
  if (until <= today) return EMPTY;
  const from = start > today ? start : today;

  const [planAccounts, lines, { byId }] = await Promise.all([
    BudgetPlanAccounts.findAll({
      where: { planId: plan.id },
      attributes: ['accountId'],
      include: [{ model: Accounts, attributes: [], where: { userId: plan.userId, excludeFromStats: false } }],
    }),
    loadLines({ planId: plan.id }),
    ownerCategories({ userId: plan.userId }),
  ]);
  const accountIds = planAccounts.map((row) => row.accountId);
  const lineCategories = await BudgetLineCategories.findAll({
    where: { lineId: { [Op.in]: lines.map((line) => line.id) } },
  });
  const lineOf = lineOwnerResolver({
    membership: periodMembership({ lines, lineCategories, start }).membership,
    byId,
  });
  const lineOfCategory = ({ categoryId }: { categoryId: string | null }) =>
    categoryId === null ? null : lineOf(categoryId);

  const [subscriptions, planned] = await Promise.all([
    Subscriptions.findAll({
      where: {
        userId: plan.userId,
        isActive: true,
        expectedAmount: { [Op.ne]: null },
        accountId: { [Op.or]: [{ [Op.in]: accountIds }, { [Op.is]: null }] },
      },
      include: scheduleInclude,
    }),
    findTransactions({
      planned: 'only',
      access: { creator: plan.userId },
      balanceAdjustments: 'exclude',
      transfers: 'exclude',
      completeness: 'all',
      where: {
        accountId: { [Op.in]: accountIds },
        time: { [Op.gte]: utcInstant({ date: from }), [Op.lt]: utcInstant({ date: until }) },
      },
      include: [{ model: Payees, attributes: ['name'] }],
    }),
  ]);

  const plannedLinks = planned.length
    ? await SubscriptionTransactions.findAll({
        where: { transactionId: { [Op.in]: planned.map((tx) => tx.id) }, status: SUBSCRIPTION_LINK_STATUS.active },
      })
    : [];
  const plannedDateById = new Map(planned.map((tx) => [tx.id, toUtcDateString(tx.time)]));
  // A planned row linked to a subscription stands in for that day's occurrence.
  const coveredOccurrences = new Set(
    plannedLinks.map((link) => `${link.subscriptionId}:${plannedDateById.get(link.transactionId)}`),
  );

  const subscriptionItems = await Promise.all(
    subscriptions
      .filter((sub) => sub.accountId !== null || lineOfCategory({ categoryId: sub.categoryId }) !== null)
      .flatMap((sub) =>
        paymentDatesInRange({ subscription: sub, from, until })
          .filter((date) => !coveredOccurrences.has(`${sub.id}:${date}`))
          .map((date) => ({ sub, date })),
      )
      .map(async ({ sub, date }): Promise<BudgetPlanScheduledItem | null> => {
        const currencyCode = sub.expectedCurrencyCode ?? plan.currencyCode;
        const native = signed({ amount: sub.expectedAmount!, type: sub.transactionType });
        let base = native;
        if (currencyCode !== plan.currencyCode) {
          try {
            base = await calculateRefAmount({
              userId: plan.userId,
              amount: native,
              baseCode: currencyCode,
              quoteCode: plan.currencyCode,
              date: today,
            });
          } catch (e) {
            if (!(e instanceof ExchangeRateUnavailableError)) throw e;
            logger.warn('[Budget plans] Scheduled subscription skipped: no exchange rate', {
              planId: plan.id,
              subscriptionId: sub.id,
              currencyCode,
            });
            return null;
          }
        }

        return {
          source: 'subscription',
          id: sub.id,
          name: sub.name,
          date,
          amount: base.toNumber(),
          currencyCode,
          nativeAmount: native.toNumber(),
          categoryId: sub.categoryId,
          lineId: lineOfCategory({ categoryId: sub.categoryId }),
          accountId: sub.accountId,
        };
      }),
  ).then((results) => results.filter((item) => item !== null));

  const plannedItems = planned.map(
    (tx): BudgetPlanScheduledItem => ({
      source: 'planned',
      id: tx.id,
      name: tx.payee?.name || tx.note || '',
      date: plannedDateById.get(tx.id)!,
      amount: signed({ amount: tx.refAmount, type: tx.transactionType }).toNumber(),
      currencyCode: tx.currencyCode,
      nativeAmount: signed({ amount: tx.amount, type: tx.transactionType }).toNumber(),
      categoryId: tx.categoryId,
      lineId: lineOfCategory({ categoryId: tx.categoryId }),
      accountId: tx.accountId,
    }),
  );

  const items = [...subscriptionItems, ...plannedItems].toSorted(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
  const outflows = totals({ items: items.filter((item) => item.amount < 0) });
  const inflows = totals({ items: items.filter((item) => item.amount >= 0) });

  return {
    items,
    outflows: { total: outflows.total.toNumber(), count: outflows.count },
    inflows: { total: inflows.total.toNumber(), count: inflows.count },
    nextDate: items[0]?.date ?? null,
  };
};
