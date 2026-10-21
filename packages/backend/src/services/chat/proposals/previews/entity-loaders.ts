import {
  type ChatEntityKind,
  isTwoLegTransfer,
  type RecordId,
  RESOURCE_TYPES,
  SHARE_PERMISSIONS,
  TRANSACTION_TRANSFER_NATURE,
} from '@bt/shared/types';
import AccountGrouping from '@models/accounts-groups/account-grouping.model';
import AccountGroups from '@models/accounts-groups/account-groups.model';
import Accounts from '@models/accounts.model';
import BudgetAssignments from '@models/budget-assignments.model';
import BudgetLineCategories from '@models/budget-line-categories.model';
import BudgetLineGoals from '@models/budget-line-goals.model';
import BudgetLineGroups from '@models/budget-line-groups.model';
import BudgetLines from '@models/budget-lines.model';
import Categories from '@models/categories.model';
import Currencies from '@models/currencies.model';
import Holdings from '@models/investments/holdings.model';
import InvestmentTransactions from '@models/investments/investment-transaction.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Portfolios from '@models/investments/portfolios.model';
import LoanDetails from '@models/loan-details.model';
import PayeeAliases from '@models/payee-aliases.model';
import Payees from '@models/payees.model';
import RefundTransactions from '@models/refund-transactions.model';
import SubscriptionPeriods from '@models/subscription-periods.model';
import SubscriptionTransactions from '@models/subscription-transactions.model';
import Subscriptions from '@models/subscriptions.model';
import TagReminders from '@models/tag-reminders.model';
import Tags from '@models/tags.model';
import TrackerTransactions from '@models/tracker-transactions.model';
import Trackers from '@models/trackers.model';
import TransactionAttachments from '@models/transaction-attachments.model';
import TransactionAutomations from '@models/transaction-automations.model';
import TransactionGroupItems from '@models/transaction-group-items.model';
import TransactionGroups from '@models/transaction-groups.model';
import TransactionSplits from '@models/transaction-splits.model';
import TransactionTags from '@models/transaction-tags.model';
import TransactionTemplates from '@models/transaction-templates.model';
import { countTransactions, findOneTransaction } from '@models/transactions-query';
import type Transactions from '@models/transactions.model';
import UsersCurrencies from '@models/users-currencies.model';
import Vehicles from '@models/vehicles.model';
import VentureDeals from '@models/venture/venture-deals.model';
import VentureEventLinks from '@models/venture/venture-event-links.model';
import VentureEvents from '@models/venture/venture-events.model';
import VenturePlatforms from '@models/venture/venture-platforms.model';
import { countCategoryTransactions } from '@services/categories/count-category-transactions';
import { canUserAccessResource } from '@services/sharing/auth/can-user-access-resource.service';
import { getSubscriptionTagIds } from '@services/subscriptions/subscription-tags';
import { Op, type Model, type ModelStatic, type WhereOptions } from 'sequelize';

import {
  canSeeTransaction,
  countPayeeReferences,
  findPlanOrNull,
  forUpdate,
  loadTransferTwins,
  serializeRow,
} from './preview-helpers';

/** An entity a card targets, read for its preview. */
export interface LoadedEntity {
  /** The row as JSON; `null` when the entity does not exist yet (a goal a `set_` call creates). */
  row: Record<string, unknown> | null;
  updatedAt: Date | null;
  /** Related counts, such as the transactions an account holds. */
  counts: Record<string, number>;
  /** Rows that go when the entity is deleted, on top of itself (an account's transactions). */
  removes: number;
  /**
   * The transactions a transaction call touches when it is a two-leg transfer: the target first,
   * then the other leg, which the service reads by `transferId` and updates or deletes with it.
   */
  legs?: Transactions[];
}

/**
 * Reads the entity the targets name, scoped to the user. The targets come in the order the policy's
 * `targetFields` list them: a parent id first where the entity lives under one. `null` is a target
 * that is not there (or not the user's). `args` are the call's arguments, for a delete whose reach
 * an argument picks. With `lock` the rows are held in the order the services take them: a budget
 * plan first, then the entity's own row `FOR UPDATE`. Other parents and the related counts are read
 * as they are.
 */
type EntityLoader = (params: {
  userId: number;
  targets: string[];
  args?: Record<string, unknown>;
  lock?: boolean;
}) => Promise<LoadedEntity | null>;

type AnyModel = ModelStatic<Model>;
type Where = WhereOptions;

interface Related {
  counts?: Record<string, number>;
  removes?: number;
  legs?: Transactions[];
}

const updatedAtOf = ({ record }: { record: Model }): Date | null =>
  (record as unknown as { updatedAt?: Date | null }).updatedAt ?? null;

const loaded = ({ record, related }: { record: Model; related?: Related }): LoadedEntity => ({
  row: serializeRow({ row: record }),
  updatedAt: updatedAtOf({ record }),
  counts: related?.counts ?? {},
  removes: related?.removes ?? 0,
  ...(related?.legs ? { legs: related.legs } : {}),
});

/** The counts that are not zero: a card lists what goes with its target, not what does not. */
const nonZero = ({ counts }: { counts: Record<string, number> }): Record<string, number> =>
  Object.fromEntries(Object.entries(counts).filter(([, count]) => count > 0));

/** Transactions on the accounts the user can access that match, counted at the transactions boundary. */
const accessibleTransactions = ({ userId, where }: { userId: number; where: Record<string, unknown> }) =>
  countTransactions({
    planned: 'include',
    access: { accessibleTo: userId },
    balanceAdjustments: 'include',
    where: where as never,
  });

/** An entity with a `userId` column, found by one id; `related` reads its counts. */
const owned =
  ({
    model,
    key = 'id',
    related,
  }: {
    model: AnyModel;
    key?: string;
    related?: (params: { userId: number; id: string }) => Promise<Related>;
  }): EntityLoader =>
  async ({ userId, targets, lock }) => {
    const id = targets[0]!;
    const record = await model.findOne({ where: { [key]: id, userId } as Where, ...forUpdate({ lock }) });
    if (!record) return null;

    return loaded({ record, related: await related?.({ userId, id }) });
  };

/** An entity that belongs to the user through a parent: the parent is checked first. */
const under =
  ({
    parent,
    model,
    where,
    related,
    optional = false,
  }: {
    parent: (params: { userId: number; targets: string[]; lock?: boolean }) => Promise<Model | null>;
    model: AnyModel;
    where: (targets: string[]) => Where;
    related?: (params: { targets: string[] }) => Promise<Related>;
    optional?: boolean;
  }): EntityLoader =>
  async ({ userId, targets, lock }) => {
    if (!(await parent({ userId, targets, lock }))) return null;

    const record = await model.findOne({ where: where(targets), ...forUpdate({ lock }) });
    if (!record) return optional ? { row: null, updatedAt: null, counts: {}, removes: 0 } : null;

    return loaded({ record, related: await related?.({ targets }) });
  };

/** A budget plan of the user; under `lock` it is held first, as every plan write holds it. */
const planOf = ({ userId, targets, lock }: { userId: number; targets: string[]; lock?: boolean }) =>
  findPlanOrNull({ planId: targets[0]!, userId, lock });

const portfolioOf = ({ userId, targets }: { userId: number; targets: string[] }) =>
  Portfolios.findOne({ where: { id: targets[0]!, userId } });

const lineOf = ({ targets }: { targets: string[] }) =>
  BudgetLines.findOne({ where: { id: targets[1]!, planId: targets[0]! } });

export const ENTITY_LOADERS: Partial<Record<ChatEntityKind, EntityLoader>> = {
  // The services authorize a transaction by the user's access to its account, not by who wrote it.
  // A delete or update of one leg of a transfer reaches the other leg too, found by `transferId`
  // whoever wrote it. It reads the other rows the transaction goes with as well.
  transaction: async ({ userId, targets, lock }) => {
    const id = targets[0]!;
    const record = await findOneTransaction({
      ...forUpdate({ lock }),
      planned: 'include',
      access: { accessibleTo: userId },
      balanceAdjustments: 'include',
      where: { id },
    });
    if (!record) return null;

    const twins =
      isTwoLegTransfer(record.transferNature) && record.transferId
        ? await loadTransferTwins({ rows: [record], lock })
        : [];
    const hasPortfolioTransfer = record.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio;

    return loaded({
      record,
      related: {
        counts: nonZero({
          counts: {
            transferTwinCount: twins.length,
            splitCount: await TransactionSplits.count({ where: { transactionId: id } }),
            refundLinkCount: await RefundTransactions.count({
              where: { [Op.or]: [{ originalTxId: id }, { refundTxId: id }] },
            }),
            subscriptionLinkCount: await SubscriptionTransactions.count({ where: { transactionId: id } }),
            portfolioTransferCount: hasPortfolioTransfer
              ? await PortfolioTransfers.count({ where: { transactionId: id } })
              : 0,
          },
        }),
        ...(twins.length > 0 ? { legs: [record, ...twins] } : {}),
      },
    });
  },

  account: owned({
    model: Accounts,
    related: async ({ userId, id }) => {
      const transactionCount = await accessibleTransactions({ userId, where: { accountId: id } });
      return { counts: { transactionCount }, removes: transactionCount };
    },
  }),

  accountGroup: owned({
    model: AccountGroups,
    related: async ({ userId, id }) => ({
      counts: {
        accountCount: await AccountGrouping.count({ where: { groupId: id } }),
        subgroupCount: await AccountGroups.count({ where: { parentGroupId: id, userId } }),
      },
    }),
  }),

  category: owned({
    model: Categories,
    related: async ({ userId, id }) => ({
      counts: {
        transactionCount: await countCategoryTransactions({ categoryId: id as RecordId, userId }),
        subcategoryCount: await Categories.count({ where: { parentId: id, userId } }),
      },
    }),
  }),

  tag: owned({
    model: Tags,
    related: async ({ id }) => ({
      counts: { transactionCount: await TransactionTags.count({ where: { tagId: id } }) },
    }),
  }),

  tagReminder: async ({ userId, targets, lock }) => {
    const record = await TagReminders.findOne({
      where: { id: targets[1]!, tagId: targets[0]!, userId },
      ...forUpdate({ lock }),
    });
    return record ? loaded({ record }) : null;
  },

  payee: owned({
    model: Payees,
    related: async ({ userId, id }) => ({
      counts: {
        transactionCount: await countPayeeReferences({ userId, payeeId: id }),
        aliasCount: await PayeeAliases.count({ where: { payeeId: id } }),
      },
    }),
  }),

  payeeAlias: under({
    parent: ({ userId, targets }) => Payees.findOne({ where: { id: targets[0]!, userId } }),
    model: PayeeAliases,
    where: (targets) => ({ id: targets[1]!, payeeId: targets[0]! }),
  }),

  // A shared tracker is edited and archived by a recipient with write access, so the tracker is found
  // through the user's access to it and read as its owner's row.
  tracker: async ({ userId, targets, lock }) => {
    const id = targets[0]!;
    const access = await canUserAccessResource({
      userId,
      resourceType: RESOURCE_TYPES.tracker,
      resourceId: id,
      requiredPermission: SHARE_PERMISSIONS.read,
    });
    if (!access.granted) return null;

    const record = await Trackers.findOne({ where: { id, userId: access.ownerUserId }, ...forUpdate({ lock }) });
    if (!record) return null;

    return loaded({
      record,
      related: { counts: { transactionCount: await TrackerTransactions.count({ where: { trackerId: id } }) } },
    });
  },

  budgetPlan: async ({ userId, targets, lock }) => {
    const record = await planOf({ userId, targets, lock });
    if (!record) return null;

    return loaded({
      record,
      related: { counts: { lineCount: await BudgetLines.count({ where: { planId: record.id } }) } },
    });
  },

  budgetPlanGroup: under({
    parent: planOf,
    model: BudgetLineGroups,
    where: (targets) => ({ id: targets[1]!, planId: targets[0]! }),
  }),

  // Deleting a line cascades its assignments and category memberships.
  budgetPlanLine: under({
    parent: planOf,
    model: BudgetLines,
    where: (targets) => ({ id: targets[1]!, planId: targets[0]! }),
    related: async ({ targets }) => ({
      counts: {
        assignmentCount: await BudgetAssignments.count({ where: { lineId: targets[1]! } }),
        categoryCount: await BudgetLineCategories.count({ where: { lineId: targets[1]! } }),
      },
    }),
  }),

  budgetPlanLineGoal: under({
    parent: async ({ userId, targets, lock }) =>
      (await planOf({ userId, targets, lock })) ? lineOf({ targets }) : null,
    model: BudgetLineGoals,
    where: (targets) => ({ lineId: targets[1]! }),
    optional: true,
  }),

  // Deleting a subscription unlinks its transactions and drops its periods. Its tags live in a join
  // table, so they are added to the row for the card to show the set an update replaces.
  subscription: async (params) => {
    const loadedSubscription = await owned({
      model: Subscriptions,
      related: async ({ id }) => ({
        counts: {
          linkedTransactionCount: await SubscriptionTransactions.count({ where: { subscriptionId: id } }),
          periodCount: await SubscriptionPeriods.count({ where: { subscriptionId: id } }),
        },
      }),
    })(params);
    if (!loadedSubscription?.row) return loadedSubscription;

    const tagIds = await getSubscriptionTagIds({ subscriptionId: params.targets[0]! });
    return { ...loadedSubscription, row: { ...loadedSubscription.row, tagIds: tagIds.toSorted() } };
  },

  loan: owned({ model: LoanDetails, key: 'accountId' }),

  vehicle: owned({ model: Vehicles }),

  portfolio: owned({
    model: Portfolios,
    related: async ({ id }) => ({
      counts: {
        holdingCount: await Holdings.count({ where: { portfolioId: id } }),
        investmentTransactionCount: await InvestmentTransactions.count({ where: { portfolioId: id } }),
      },
    }),
  }),

  holding: under({
    parent: portfolioOf,
    model: Holdings,
    where: (targets) => ({ portfolioId: targets[0]!, securityId: targets[1]! }),
  }),

  investmentTransaction: async ({ userId, targets, lock }) => {
    const record = await InvestmentTransactions.findOne({ where: { id: targets[0]! }, ...forUpdate({ lock }) });
    if (!record) return null;

    const portfolio = await Portfolios.findOne({ where: { id: record.portfolioId, userId } });
    return portfolio ? loaded({ record }) : null;
  },

  transactionGroup: owned({
    model: TransactionGroups,
    related: async ({ id }) => ({
      counts: { transactionCount: await TransactionGroupItems.count({ where: { groupId: id } }) },
    }),
  }),

  transactionAutomation: owned({ model: TransactionAutomations }),

  transactionTemplate: owned({ model: TransactionTemplates }),

  customCurrency: async ({ userId, targets, lock }) => {
    const record = await Currencies.findOne({
      where: { code: targets[0]!, isCustom: true, createdByUserId: userId },
      ...forUpdate({ lock }),
    });
    return record ? loaded({ record }) : null;
  },

  userCurrency: owned({
    model: UsersCurrencies,
    key: 'currencyCode',
    related: async ({ userId, id }) => ({
      counts: { accountCount: await Accounts.count({ where: { currencyCode: id, userId } }) },
    }),
  }),

  venturePlatform: owned({
    model: VenturePlatforms,
    related: async ({ userId, id }) => ({
      counts: { dealCount: await VentureDeals.count({ where: { platformId: id, userId } }) },
    }),
  }),

  ventureDeal: owned({
    model: VentureDeals,
    related: async ({ userId, id }) => ({
      counts: { eventCount: await VentureEvents.count({ where: { dealId: id, userId } }) },
    }),
  }),

  ventureEvent: owned({
    model: VentureEvents,
    related: async ({ id }) => ({
      counts: { linkCount: await VentureEventLinks.count({ where: { ventureEventId: id } }) },
    }),
  }),

  ventureEventLink: under({
    parent: ({ userId, targets }) => VentureEvents.findOne({ where: { id: targets[0]!, userId } }),
    model: VentureEventLinks,
    where: (targets) => ({ id: targets[1]!, ventureEventId: targets[0]! }),
  }),

  split: async ({ userId, targets, lock }) => {
    const record = await TransactionSplits.findOne({ where: { id: targets[0]!, userId }, ...forUpdate({ lock }) });
    if (!record || !(await canSeeTransaction({ userId, id: record.transactionId }))) return null;

    return loaded({ record });
  },

  // With `deleteLinkedTransaction` the delete removes the account transaction the transfer made.
  portfolioTransfer: async ({ userId, targets, args, lock }) => {
    const record = await PortfolioTransfers.findOne({ where: { id: targets[0]!, userId }, ...forUpdate({ lock }) });
    if (!record) return null;

    const removesTransaction = args?.deleteLinkedTransaction === true && Boolean(record.transactionId);
    return loaded({
      record,
      related: removesTransaction ? { counts: { linkedTransactionCount: 1 }, removes: 1 } : undefined,
    });
  },

  // Attachments follow the access to their transaction: a recipient's upload on a shared account is
  // theirs to read only while the share lasts, and the owner reads every upload on their account.
  attachment: async ({ userId, targets, lock }) => {
    const record = await TransactionAttachments.findOne({ where: { id: targets[0]! }, ...forUpdate({ lock }) });
    if (!record || !(await canSeeTransaction({ userId, id: record.transactionId }))) return null;

    return loaded({ record });
  },
};
