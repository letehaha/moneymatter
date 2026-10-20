import {
  SUBSCRIPTION_LINK_STATUS,
  SUBSCRIPTION_PERIOD_STATUSES,
  type SubscriptionPeriodStatus,
} from '@bt/shared/types';
import { centsToApiDecimalOrNull } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import Accounts from '@models/accounts.model';
import Categories from '@models/categories.model';
import SubscriptionPeriods from '@models/subscription-periods.model';
import SubscriptionTransactions from '@models/subscription-transactions.model';
import Subscriptions from '@models/subscriptions.model';
import { transactionsInclude } from '@models/transactions-query';
import type { TransactionsAttributes } from '@models/transactions.model';
import { applyCachedLogos, enqueueLogoResolution } from '@services/brand-logos';
import { col, fn, literal, Op } from 'sequelize';

import { OPEN_STATUSES } from './ensure-next-period';
import { sortSubscriptions, type SubscriptionSortBy } from './sort-subscriptions';
import { resolveNextExpectedDate } from './subscription-date.utils';
import { getSubscriptionTagIds, loadSubscriptionTagIds } from './subscription-tags';

interface GetSubscriptionsParams {
  userId: number;
  isActive?: boolean;
  type?: string;
  sortBy?: SubscriptionSortBy;
}

// The included associations are loaded with trimmed attribute sets.
type SubscriptionAccount = Pick<Accounts, 'id' | 'name' | 'currencyCode'>;
type SubscriptionCategory = Pick<Categories, 'id' | 'name' | 'color' | 'icon'>;

/**
 * Subscription scalar columns plus its trimmed account/category associations.
 * `expectedAmount` is a cents-backed Money on the model but is surfaced here as a
 * decimal number, so it is re-typed rather than picked from the model.
 */
interface SubscriptionBase extends Pick<
  Subscriptions,
  | 'id'
  | 'userId'
  | 'name'
  | 'type'
  | 'expectedCurrencyCode'
  | 'frequency'
  | 'startDate'
  | 'endDate'
  | 'dueDate'
  | 'accountId'
  | 'categoryId'
  | 'payeeId'
  | 'matchingRules'
  | 'isActive'
  | 'autoRecord'
  | 'transactionType'
  | 'completedAt'
  | 'maxOccurrences'
  | 'notes'
  | 'remindBefore'
  | 'notifyEmail'
  | 'logoDomain'
  | 'logoSource'
  | 'logoInitials'
  | 'logoColor'
  | 'logoIcon'
  | 'logoImageId'
  | 'createdAt'
  | 'updatedAt'
> {
  /** Cents-backed Money on the model, surfaced here as a decimal number. */
  expectedAmount: number | null;
  tagIds: string[];
  account: SubscriptionAccount | null;
  category: SubscriptionCategory | null;
}

/**
 * Lazy-on-read logo backfill for subscriptions with `logoSource IS NULL`.
 * Stamps `BrandLogos` cache hits onto the model instances (not their toJSON
 * projections) so hits are reflected when the caller serializes them on THIS
 * request; cache misses are enqueued for async logo.dev resolution.
 */
async function backfillLogosForUnresolved({ subscriptions }: { subscriptions: Subscriptions[] }): Promise<void> {
  const misses = await applyCachedLogos({ entity: 'subscription', rows: subscriptions });
  for (const subscription of misses) {
    void enqueueLogoResolution({ entity: 'subscription', id: subscription.id });
  }
}

/** Minimal period shape exposed on the list – enough for a "Due in N days" chip. */
interface CurrentPeriod {
  id: string;
  dueDate: string;
  status: SubscriptionPeriodStatus;
}

interface SubscriptionListItem extends SubscriptionBase {
  linkedTransactionsCount: number;
  /** Earliest open (upcoming or overdue) period, or null for detection-only subs. */
  currentPeriod: CurrentPeriod | null;
  /** Count of periods already paid. Paired with `maxOccurrences` it renders the
   *  "N of M paid" installment progress without fetching the full periods array. */
  paidPeriodsCount: number;
  /**
   * Effective next-due date (YYYY-MM-DD): the earliest open period's `dueDate` for a
   * scheduled subscription, else derived from the latest linked active non-planned
   * transaction. Null when inactive, past `endDate`, or the schedule is consumed.
   * Drives the "in N days" chip and dueDate sort.
   */
  nextDueDate: string | null;
}

/**
 * A linked transaction: the full transaction columns with Money fields surfaced
 * as decimal numbers, plus the join-table match metadata.
 */
interface SubscriptionLinkedTransaction extends Omit<
  TransactionsAttributes,
  'amount' | 'refAmount' | 'commissionRate' | 'refCommissionRate' | 'cashbackAmount'
> {
  amount: number;
  refAmount: number;
  commissionRate: number;
  refCommissionRate: number;
  cashbackAmount: number;
  SubscriptionTransactions: Pick<SubscriptionTransactions, 'matchSource' | 'matchedAt' | 'status'>;
}

interface SubscriptionPeriodItem {
  id: string;
  subscriptionId: string;
  dueDate: string;
  status: string;
  paidAt: Date | null;
  transactionId: string | null;
  transactionAutoCreated: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface SubscriptionDetail extends SubscriptionBase {
  transactions: SubscriptionLinkedTransaction[];
  nextExpectedDate: string | null;
  periods: SubscriptionPeriodItem[];
}

export const getSubscriptions = async ({
  userId,
  isActive,
  type,
  sortBy = 'dueDate',
}: GetSubscriptionsParams): Promise<SubscriptionListItem[]> => {
  const where: Record<string, unknown> = { userId };
  if (isActive !== undefined) where.isActive = isActive;
  if (type) where.type = type;

  const subscriptions = await Subscriptions.findAll({
    where,
    attributes: {
      include: [
        [
          fn(
            'COUNT',
            literal(
              `CASE WHEN "transactions->SubscriptionTransactions"."status" = '${SUBSCRIPTION_LINK_STATUS.active}' THEN "transactions"."id" END`,
            ),
          ),
          'linkedTransactionsCount',
        ],
      ],
    },
    include: [
      { model: Accounts, attributes: ['id', 'name', 'currencyCode'] },
      { model: Categories, attributes: ['id', 'name', 'color', 'icon'] },
      transactionsInclude({
        planned: 'exclude',
        attributes: [],
        through: { attributes: [] },
        // The boundary composes a where onto the include, which Sequelize would otherwise
        // read as INNER JOIN and drop subscriptions whose only links are planned rows.
        required: false,
      }),
    ],
    group: ['Subscriptions.id', 'account.id', 'category.id'],
    order: [['createdAt', 'DESC']],
    subQuery: false,
  });

  await backfillLogosForUnresolved({ subscriptions });

  const mapped = subscriptions.map((s) => {
    const plain = s.toJSON() as unknown as Omit<SubscriptionBase, 'tagIds'> & {
      linkedTransactionsCount: number | string | null;
    };
    return {
      ...plain,
      expectedAmount: centsToApiDecimalOrNull(plain.expectedAmount),
      linkedTransactionsCount: Number(plain.linkedTransactionsCount ?? 0),
    };
  });

  if (mapped.length === 0) {
    return [];
  }

  const subscriptionIds = mapped.map((item) => item.id);

  // One grouped query for the paid-period count across the result set, keyed by
  // subscription. Aggregate-only (no Money columns), so raw rows are safe.
  const paidCountRows = (await SubscriptionPeriods.findAll({
    where: {
      subscriptionId: { [Op.in]: subscriptionIds },
      status: SUBSCRIPTION_PERIOD_STATUSES.paid,
    },
    attributes: ['subscriptionId', [fn('COUNT', col('id')), 'count']],
    group: ['subscriptionId'],
    raw: true,
  })) as unknown as Array<{ subscriptionId: string; count: string | number }>;

  const paidCountBySubscriptionId = new Map<string, number>();
  for (const row of paidCountRows) {
    paidCountBySubscriptionId.set(row.subscriptionId, Number(row.count));
  }

  // Single query for all open periods across the result set.
  // Ordered ASC so the first row per subscriptionId is always the earliest due date.
  const openPeriods = await SubscriptionPeriods.findAll({
    where: {
      subscriptionId: { [Op.in]: subscriptionIds },
      status: { [Op.in]: [SUBSCRIPTION_PERIOD_STATUSES.upcoming, SUBSCRIPTION_PERIOD_STATUSES.overdue] },
    },
    attributes: ['id', 'subscriptionId', 'dueDate', 'status'],
    order: [['dueDate', 'ASC']],
  });

  // Keep only the earliest open period per subscription (first occurrence wins because of ASC order).
  const earliestBySubscriptionId = new Map<string, CurrentPeriod>();
  for (const period of openPeriods) {
    const { subscriptionId, id, dueDate, status } = period;
    if (!earliestBySubscriptionId.has(subscriptionId)) {
      earliestBySubscriptionId.set(subscriptionId, { id, dueDate, status });
    }
  }

  // Latest linked ACTIVE, non-planned transaction time per subscription. Feeds the derived
  // next-due date for detection-only subs that have no open period. Selects only
  // the DATE column (no Money columns), so raw rows are safe.
  const latestTxRows = (await Subscriptions.findAll({
    where: { id: { [Op.in]: subscriptionIds } },
    attributes: ['id', [fn('MAX', col('transactions.time')), 'latestTime']],
    include: [
      transactionsInclude({
        planned: 'exclude',
        attributes: [],
        through: { attributes: [], where: { status: SUBSCRIPTION_LINK_STATUS.active } },
        required: false,
      }),
    ],
    group: ['Subscriptions.id'],
    subQuery: false,
    raw: true,
  })) as unknown as Array<{ id: string; latestTime: Date | string | null }>;

  const latestTxTimeBySubscriptionId = new Map<string, Date | string>();
  for (const row of latestTxRows) {
    if (row.latestTime) latestTxTimeBySubscriptionId.set(row.id, row.latestTime);
  }

  const tagIdsBySubscriptionId = await loadSubscriptionTagIds({ subscriptionIds });

  const items: SubscriptionListItem[] = mapped.map((item) => {
    const currentPeriod = earliestBySubscriptionId.get(item.id) ?? null;
    const latestTxTime = latestTxTimeBySubscriptionId.get(item.id);
    return {
      ...item,
      tagIds: tagIdsBySubscriptionId.get(item.id) ?? [],
      currentPeriod,
      paidPeriodsCount: paidCountBySubscriptionId.get(item.id) ?? 0,
      nextDueDate: resolveNextExpectedDate({
        startDate: item.startDate,
        frequency: item.frequency,
        transactions: latestTxTime ? [{ time: latestTxTime }] : [],
        isActive: item.isActive,
        endDate: item.endDate,
        dueDate: item.dueDate,
        openPeriodDueDate: currentPeriod?.dueDate ?? null,
      }),
    };
  });

  return sortSubscriptions({ items, sortBy });
};

export const getSubscriptionById = async ({
  id,
  userId,
}: {
  id: string;
  userId: number;
}): Promise<SubscriptionDetail> => {
  const subscription = await findOrThrowNotFound({
    query: Subscriptions.findOne({
      where: { id, userId },
      include: [
        { model: Accounts, attributes: ['id', 'name', 'currencyCode'] },
        { model: Categories, attributes: ['id', 'name', 'color', 'icon'] },
        // The detail dialog is the only place a planned link can be unlinked, so its
        // payload keeps planned rows.
        transactionsInclude({
          planned: 'include',
          required: false,
          through: {
            attributes: ['matchSource', 'matchedAt', 'status'],
            where: { status: SUBSCRIPTION_LINK_STATUS.active },
          },
        }),
        {
          model: SubscriptionPeriods,
          as: 'periods',
        },
      ],
      order: [[{ model: SubscriptionPeriods, as: 'periods' }, 'dueDate', 'ASC']],
    }),
    message: 'Subscription not found.',
  });

  await backfillLogosForUnresolved({ subscriptions: [subscription] });

  // toJSON() is untyped; describe the loaded shape (Money fields still boxed,
  // join-table metadata nested under SubscriptionTransactions) so the rest is typed.
  const raw = subscription.toJSON() as unknown as Omit<SubscriptionBase, 'tagIds'> & {
    transactions?: Array<
      TransactionsAttributes & {
        SubscriptionTransactions: Pick<SubscriptionTransactions, 'matchSource' | 'matchedAt' | 'status'>;
      }
    >;
    periods?: SubscriptionPeriodItem[];
  };

  const transactions: SubscriptionLinkedTransaction[] = (raw.transactions ?? []).map((tx) => ({
    ...tx,
    amount: tx.amount.toNumber(),
    refAmount: tx.refAmount.toNumber(),
    commissionRate: tx.commissionRate.toNumber(),
    refCommissionRate: tx.refCommissionRate.toNumber(),
    cashbackAmount: tx.cashbackAmount.toNumber(),
  }));

  const periods = raw.periods ?? [];
  // `periods` arrive ordered by dueDate ASC, so the first open one is the earliest.
  const openPeriod = periods.find((p) => OPEN_STATUSES.some((status) => status === p.status));

  const nextExpectedDate = resolveNextExpectedDate({
    startDate: raw.startDate,
    frequency: raw.frequency,
    transactions: transactions.filter((tx) => !tx.isPlanned),
    isActive: raw.isActive,
    endDate: raw.endDate,
    dueDate: raw.dueDate,
    openPeriodDueDate: openPeriod?.dueDate ?? null,
  });

  return {
    ...raw,
    expectedAmount: centsToApiDecimalOrNull(raw.expectedAmount),
    tagIds: await getSubscriptionTagIds({ subscriptionId: id }),
    transactions,
    nextExpectedDate,
    periods,
  };
};
