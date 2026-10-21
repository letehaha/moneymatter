import { TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import Accounts from '@models/accounts.model';
import BudgetAssignments from '@models/budget-assignments.model';
import BudgetLineCategories from '@models/budget-line-categories.model';
import BudgetLineGoals from '@models/budget-line-goals.model';
import BudgetLineGroups from '@models/budget-line-groups.model';
import BudgetLines from '@models/budget-lines.model';
import BudgetPlans from '@models/budget-plans.model';
import Categories from '@models/categories.model';
import { namespace } from '@models/connection';
import Currencies from '@models/currencies.model';
import Holdings from '@models/investments/holdings.model';
import InvestmentTransactions from '@models/investments/investment-transaction.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Portfolios from '@models/investments/portfolios.model';
import PayeeAliases from '@models/payee-aliases.model';
import Payees from '@models/payees.model';
import RefundTransactions from '@models/refund-transactions.model';
import SubscriptionPeriods from '@models/subscription-periods.model';
import SubscriptionTags from '@models/subscription-tags.model';
import SubscriptionTransactions from '@models/subscription-transactions.model';
import Subscriptions from '@models/subscriptions.model';
import TagReminders from '@models/tag-reminders.model';
import Tags from '@models/tags.model';
import TrackerTransactions from '@models/tracker-transactions.model';
import Trackers from '@models/trackers.model';
import TransactionAttachments from '@models/transaction-attachments.model';
import TransactionSplits from '@models/transaction-splits.model';
import TransactionTags from '@models/transaction-tags.model';
import UsersCurrencies from '@models/users-currencies.model';
import VentureEventLinks from '@models/venture/venture-event-links.model';
import VentureEvents from '@models/venture/venture-events.model';
import { Op } from 'sequelize';

import { ENTITY_LOADER_KINDS } from '../../policies/explicit';

jest.mock('@models/transactions-query', () => ({
  ...(jest.requireActual('@models/transactions-query') as object),
  findOneTransaction: jest.fn(),
  findTransactions: jest.fn(),
  countTransactions: jest.fn(),
}));

jest.mock('@services/categories/count-category-transactions', () => ({ countCategoryTransactions: jest.fn() }));
jest.mock('@services/sharing/auth/can-user-access-resource.service', () => ({ canUserAccessResource: jest.fn() }));

import * as transactionsQuery from '@models/transactions-query';
import { countCategoryTransactions } from '@services/categories/count-category-transactions';
import { canUserAccessResource } from '@services/sharing/auth/can-user-access-resource.service';

import { ENTITY_LOADERS } from './entity-loaders';

const USER = 7;
const ID = '3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c11';
const OTHER = '9a7c5e31-2b84-4d0f-8e66-1c3a5b7d9f20';
const UPDATED = new Date('2026-10-18T09:00:00.000Z');

const record = (values: Record<string, unknown>) => ({
  updatedAt: UPDATED,
  ...values,
  toJSON: () => ({ updatedAt: UPDATED, ...values }),
});

const load = ({ kind, targets }: { kind: string; targets: string[] }) =>
  (ENTITY_LOADERS as Record<string, NonNullable<(typeof ENTITY_LOADERS)[keyof typeof ENTITY_LOADERS]>>)[kind]!({
    userId: USER,
    targets,
  });

const whereOf = (spy: unknown) =>
  (jest.mocked(spy as never) as jest.Mock<(...args: unknown[]) => unknown>).mock.calls[0]![0] as {
    where: Record<string, unknown>;
  };

describe('entity loaders', () => {
  beforeEach(() => {
    jest.mocked(transactionsQuery.countTransactions).mockResolvedValue(0);
    jest.mocked(transactionsQuery.findOneTransaction).mockResolvedValue(null);
    jest
      .mocked(transactionsQuery.findTransactions)
      .mockReset()
      .mockResolvedValue([] as never);
    for (const model of [
      TransactionSplits,
      RefundTransactions,
      SubscriptionTransactions,
      SubscriptionPeriods,
      PortfolioTransfers,
      BudgetAssignments,
      BudgetLineCategories,
    ]) {
      jest.spyOn(model as never as typeof TransactionSplits, 'count').mockResolvedValue(0 as never);
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('has a loader for every entity the policies send to the entity resolver, and for no other', () => {
    expect(Object.keys(ENTITY_LOADERS).toSorted()).toEqual([...ENTITY_LOADER_KINDS].toSorted());
  });

  it('loads a transaction through the transactions boundary, scoped to the accounts the user can access', async () => {
    jest.mocked(transactionsQuery.findOneTransaction).mockResolvedValue(record({ id: ID, note: 'Coffee' }) as never);

    const loaded = await load({ kind: 'transaction', targets: [ID] });

    expect(loaded).toMatchObject({ row: { id: ID, note: 'Coffee' }, updatedAt: UPDATED, removes: 0 });
    expect(jest.mocked(transactionsQuery.findOneTransaction).mock.calls[0]![0]).toMatchObject({
      access: { accessibleTo: USER },
      where: { id: ID },
    });
  });

  it('holds the row FOR UPDATE only when asked to lock, whether the entity is owned, nested or a transaction', async () => {
    const accountFind = jest.spyOn(Accounts, 'findOne').mockResolvedValue(record({ id: ID }) as never);
    jest.spyOn(Accounts, 'count').mockResolvedValue(0);
    jest.mocked(transactionsQuery.findOneTransaction).mockResolvedValue(record({ id: ID }) as never);
    const reminderFind = jest.spyOn(TagReminders, 'findOne').mockResolvedValue(record({ id: OTHER }) as never);

    await ENTITY_LOADERS.account!({ userId: USER, targets: [ID] });
    await ENTITY_LOADERS.account!({ userId: USER, targets: [ID], lock: true });
    await ENTITY_LOADERS.transaction!({ userId: USER, targets: [ID], lock: true });
    await ENTITY_LOADERS.tagReminder!({ userId: USER, targets: [ID, OTHER], lock: true });

    expect(accountFind.mock.calls[0]![0]).not.toHaveProperty('lock');
    expect(accountFind.mock.calls[1]![0]).toMatchObject({ lock: true });
    expect(jest.mocked(transactionsQuery.findOneTransaction).mock.calls.at(-1)![0]).toMatchObject({ lock: true });
    expect(reminderFind.mock.calls[0]![0]).toMatchObject({ lock: true });
  });

  it('counts the transactions of an account and reports them as the rows a delete removes', async () => {
    const find = jest.spyOn(Accounts, 'findOne').mockResolvedValue(record({ id: ID, name: 'Cash' }) as never);
    jest.mocked(transactionsQuery.countTransactions).mockResolvedValue(12);

    const loaded = await load({ kind: 'account', targets: [ID] });

    expect(whereOf(find).where).toEqual({ id: ID, userId: USER });
    expect(loaded).toMatchObject({ row: { name: 'Cash' }, counts: { transactionCount: 12 }, removes: 12 });
    expect(jest.mocked(transactionsQuery.countTransactions).mock.calls.at(-1)![0]).toMatchObject({
      access: { accessibleTo: USER },
      where: { accountId: ID },
    });
  });

  it('answers null for an entity that is not there', async () => {
    jest.spyOn(Accounts, 'findOne').mockResolvedValue(null);

    expect(await load({ kind: 'account', targets: [ID] })).toBeNull();
  });

  it('counts the transactions of a category the way the delete does, and its subcategories', async () => {
    const find = jest.spyOn(Categories, 'findOne').mockResolvedValue(record({ id: ID }) as never);
    const count = jest.spyOn(Categories, 'count').mockResolvedValue(3);
    jest.mocked(countCategoryTransactions).mockResolvedValue(40);

    const loaded = await load({ kind: 'category', targets: [ID] });

    expect(countCategoryTransactions).toHaveBeenCalledWith({ categoryId: ID, userId: USER });
    expect(whereOf(find).where).toEqual({ id: ID, userId: USER });
    expect(whereOf(count).where).toEqual({ parentId: ID, userId: USER });
    expect(loaded).toMatchObject({ counts: { transactionCount: 40, subcategoryCount: 3 }, removes: 0 });
  });

  it('counts the transactions a tag is on', async () => {
    jest.spyOn(Tags, 'findOne').mockResolvedValue(record({ id: ID }) as never);
    const count = jest.spyOn(TransactionTags, 'count').mockResolvedValue(9);

    const loaded = await load({ kind: 'tag', targets: [ID] });

    expect(whereOf(count).where).toEqual({ tagId: ID });
    expect(loaded?.counts).toEqual({ transactionCount: 9 });
  });

  it('counts the transactions and aliases of a payee', async () => {
    jest.spyOn(Payees, 'findOne').mockResolvedValue(record({ id: ID }) as never);
    const aliases = jest.spyOn(PayeeAliases, 'count').mockResolvedValue(2);
    jest.mocked(transactionsQuery.countTransactions).mockResolvedValue(5);

    const loaded = await load({ kind: 'payee', targets: [ID] });

    expect(jest.mocked(transactionsQuery.countTransactions).mock.calls.at(-1)![0]).toMatchObject({
      access: { accessibleTo: USER },
      where: { payeeId: ID },
    });
    expect(whereOf(aliases).where).toEqual({ payeeId: ID });
    expect(loaded?.counts).toEqual({ transactionCount: 5, aliasCount: 2 });
  });

  it('finds a payee alias only through a payee of the user', async () => {
    const payee = jest.spyOn(Payees, 'findOne').mockResolvedValue(null);
    const alias = jest.spyOn(PayeeAliases, 'findOne').mockResolvedValue(record({ id: OTHER }) as never);

    expect(await load({ kind: 'payeeAlias', targets: [ID, OTHER] })).toBeNull();
    expect(whereOf(payee).where).toMatchObject({ id: ID, userId: USER });
    expect(alias).not.toHaveBeenCalled();

    payee.mockResolvedValue(record({ id: ID }) as never);
    const loaded = await load({ kind: 'payeeAlias', targets: [ID, OTHER] });

    expect(loaded?.row).toMatchObject({ id: OTHER });
    expect(jest.mocked(alias).mock.calls[0]![0]).toMatchObject({ where: { id: OTHER, payeeId: ID } });
  });

  it('finds a tag reminder by its tag and the user', async () => {
    const find = jest.spyOn(TagReminders, 'findOne').mockResolvedValue(record({ id: OTHER }) as never);

    await load({ kind: 'tagReminder', targets: [ID, OTHER] });

    expect(whereOf(find).where).toEqual({ id: OTHER, tagId: ID, userId: USER });
  });

  it('finds a budget plan line only inside a plan of the user', async () => {
    const plan = jest.spyOn(BudgetPlans, 'findOne').mockResolvedValue(null);
    const line = jest.spyOn(BudgetLines, 'findOne').mockResolvedValue(record({ id: OTHER, name: 'Food' }) as never);

    expect(await load({ kind: 'budgetPlanLine', targets: [ID, OTHER] })).toBeNull();
    expect(whereOf(plan).where).toEqual({ id: ID, userId: USER });
    expect(line).not.toHaveBeenCalled();

    plan.mockResolvedValue(record({ id: ID }) as never);
    const loaded = await load({ kind: 'budgetPlanLine', targets: [ID, OTHER] });

    expect(loaded?.row).toMatchObject({ name: 'Food' });
    expect(jest.mocked(line).mock.calls[0]![0]).toMatchObject({ where: { id: OTHER, planId: ID } });
  });

  it('loads a budget plan line goal that does not exist yet as an empty row, and refuses a line that is not there', async () => {
    jest.spyOn(BudgetPlans, 'findOne').mockResolvedValue(record({ id: ID }) as never);
    const line = jest.spyOn(BudgetLines, 'findOne').mockResolvedValue(record({ id: OTHER }) as never);
    const goal = jest.spyOn(BudgetLineGoals, 'findOne').mockResolvedValue(null);

    const loaded = await load({ kind: 'budgetPlanLineGoal', targets: [ID, OTHER] });

    expect(loaded).toMatchObject({ row: null, updatedAt: null });
    expect(whereOf(goal).where).toEqual({ lineId: OTHER });

    line.mockResolvedValue(null);
    expect(await load({ kind: 'budgetPlanLineGoal', targets: [ID, OTHER] })).toBeNull();
  });

  it('finds a custom currency by the user who defined it', async () => {
    const find = jest.spyOn(Currencies, 'findOne').mockResolvedValue(record({ code: 'PTS' }) as never);

    await load({ kind: 'customCurrency', targets: ['PTS'] });

    expect(whereOf(find).where).toEqual({ code: 'PTS', isCustom: true, createdByUserId: USER });
  });

  it('finds a user currency by code, and counts the accounts in it', async () => {
    const find = jest.spyOn(UsersCurrencies, 'findOne').mockResolvedValue(record({ currencyCode: 'EUR' }) as never);
    const accounts = jest.spyOn(Accounts, 'count').mockResolvedValue(2);

    const loaded = await load({ kind: 'userCurrency', targets: ['EUR'] });

    expect(whereOf(find).where).toEqual({ currencyCode: 'EUR', userId: USER });
    expect(whereOf(accounts).where).toEqual({ currencyCode: 'EUR', userId: USER });
    expect(loaded?.counts).toEqual({ accountCount: 2 });
  });

  it('finds a holding inside a portfolio of the user', async () => {
    jest.spyOn(Portfolios, 'findOne').mockResolvedValue(record({ id: ID }) as never);
    const holding = jest.spyOn(Holdings, 'findOne').mockResolvedValue(record({ quantity: 3 }) as never);

    const loaded = await load({ kind: 'holding', targets: [ID, OTHER] });

    expect(loaded?.row).toMatchObject({ quantity: 3 });
    expect(whereOf(holding).where).toEqual({ portfolioId: ID, securityId: OTHER });
  });

  it('finds an investment transaction only when its portfolio belongs to the user', async () => {
    jest.spyOn(InvestmentTransactions, 'findOne').mockResolvedValue(record({ id: ID, portfolioId: OTHER }) as never);
    const portfolio = jest.spyOn(Portfolios, 'findOne').mockResolvedValue(null);

    expect(await load({ kind: 'investmentTransaction', targets: [ID] })).toBeNull();
    expect(whereOf(portfolio).where).toEqual({ id: OTHER, userId: USER });

    portfolio.mockResolvedValue(record({ id: OTHER }) as never);
    expect((await load({ kind: 'investmentTransaction', targets: [ID] }))?.row).toMatchObject({ id: ID });
  });

  it('finds a venture event link inside an event of the user', async () => {
    const event = jest.spyOn(VentureEvents, 'findOne').mockResolvedValue(record({ id: ID }) as never);
    const link = jest.spyOn(VentureEventLinks, 'findOne').mockResolvedValue(record({ id: OTHER }) as never);

    const loaded = await load({ kind: 'ventureEventLink', targets: [ID, OTHER] });

    expect(loaded?.row).toMatchObject({ id: OTHER });
    expect(whereOf(event).where).toEqual({ id: ID, userId: USER });
    expect(whereOf(link).where).toEqual({ id: OTHER, ventureEventId: ID });
  });

  describe('shared entities', () => {
    const RECIPIENT_OWNER = 99;

    it('finds a tracker through the access the user has to it, and reads the owner row', async () => {
      jest
        .mocked(canUserAccessResource)
        .mockResolvedValue({ granted: true, isOwner: false, ownerUserId: RECIPIENT_OWNER } as never);
      const find = jest.spyOn(Trackers, 'findOne').mockResolvedValue(record({ id: ID, name: 'Home' }) as never);
      jest.spyOn(TrackerTransactions, 'count').mockResolvedValue(4);

      const loaded = await load({ kind: 'tracker', targets: [ID] });

      expect(jest.mocked(canUserAccessResource).mock.calls[0]![0]).toMatchObject({
        userId: USER,
        resourceType: 'tracker',
        resourceId: ID,
        requiredPermission: 'read',
      });
      expect(whereOf(find).where).toEqual({ id: ID, userId: RECIPIENT_OWNER });
      expect(loaded).toMatchObject({ row: { name: 'Home' }, counts: { transactionCount: 4 } });
    });

    it('does not find a tracker the user has no access to', async () => {
      jest.mocked(canUserAccessResource).mockResolvedValue({ granted: false, ownerUserId: RECIPIENT_OWNER } as never);
      const find = jest.spyOn(Trackers, 'findOne');

      expect(await load({ kind: 'tracker', targets: [ID] })).toBeNull();
      expect(find).not.toHaveBeenCalled();
    });

    it('finds an attachment only when its transaction is on an account the user can access', async () => {
      const find = jest
        .spyOn(TransactionAttachments, 'findOne')
        .mockResolvedValue(record({ id: ID, transactionId: OTHER, userId: 99 }) as never);
      jest.mocked(transactionsQuery.countTransactions).mockResolvedValue(0);

      expect(await load({ kind: 'attachment', targets: [ID] })).toBeNull();

      jest.mocked(transactionsQuery.countTransactions).mockResolvedValue(1);
      expect((await load({ kind: 'attachment', targets: [ID] }))?.row).toMatchObject({ id: ID });

      expect(whereOf(find).where).toEqual({ id: ID });
      expect(jest.mocked(transactionsQuery.countTransactions).mock.calls.at(-1)![0]).toMatchObject({
        access: { accessibleTo: USER },
        where: { id: OTHER },
      });
    });

    it('finds a split of the user only while its transaction is on an account the user can access', async () => {
      const find = jest
        .spyOn(TransactionSplits, 'findOne')
        .mockResolvedValue(record({ id: ID, transactionId: OTHER }) as never);
      jest.mocked(transactionsQuery.countTransactions).mockResolvedValue(0);

      expect(await load({ kind: 'split', targets: [ID] })).toBeNull();

      jest.mocked(transactionsQuery.countTransactions).mockResolvedValue(1);
      expect((await load({ kind: 'split', targets: [ID] }))?.row).toMatchObject({ id: ID });

      expect(whereOf(find).where).toEqual({ id: ID, userId: USER });
    });
  });

  describe('transfer legs and the rows a transaction takes with it', () => {
    const TWIN = '5d2e8f40-7a13-4c9b-b0e5-6f4a2c1d8e37';
    const TRANSFER = '7b1c3d5e-9f20-4a68-8c4e-0d2f4b6a8c13';
    const TWIN_UPDATED = new Date('2026-10-18T10:00:00.000Z');

    const leg = (values: Record<string, unknown> = {}) =>
      record({ id: ID, transferId: TRANSFER, transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer, ...values });

    it('loads the other leg of a two-leg transfer by its transfer id, whoever wrote it, and lists both legs', async () => {
      const target = leg();
      const twin = record({ id: TWIN, transferId: TRANSFER, updatedAt: TWIN_UPDATED });
      jest.mocked(transactionsQuery.findOneTransaction).mockResolvedValue(target as never);
      jest.mocked(transactionsQuery.findTransactions).mockResolvedValue([twin] as never);

      const loaded = await load({ kind: 'transaction', targets: [ID] });

      expect(loaded?.legs).toEqual([target, twin]);
      expect(loaded?.counts).toMatchObject({ transferTwinCount: 1 });
      expect(jest.mocked(transactionsQuery.findTransactions).mock.calls[0]![0]).toMatchObject({
        access: 'unscoped-internal',
        where: { transferId: [TRANSFER], id: { [Op.notIn]: [ID] } },
      });
    });

    it('holds the other leg FOR UPDATE with the first, only when asked to lock', async () => {
      jest.mocked(transactionsQuery.findOneTransaction).mockResolvedValue(leg() as never);

      await ENTITY_LOADERS.transaction!({ userId: USER, targets: [ID] });
      await ENTITY_LOADERS.transaction!({ userId: USER, targets: [ID], lock: true });

      const calls = jest.mocked(transactionsQuery.findTransactions).mock.calls;
      expect(calls[0]![0]).not.toHaveProperty('lock');
      expect(calls[1]![0]).toMatchObject({ lock: true });
    });

    it('reads no other leg for a transaction that is not a two-leg transfer, or whose pair is gone', async () => {
      jest
        .mocked(transactionsQuery.findOneTransaction)
        .mockResolvedValueOnce(
          record({ id: ID, transferId: null, transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer }) as never,
        )
        .mockResolvedValueOnce(
          record({ id: ID, transferId: null, transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer }) as never,
        )
        .mockResolvedValueOnce(
          record({
            id: ID,
            transferId: TRANSFER,
            transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
          }) as never,
        );

      for (let i = 0; i < 3; i++) {
        const loaded = await load({ kind: 'transaction', targets: [ID] });
        expect(loaded?.legs).toBeUndefined();
        expect(loaded?.counts).not.toHaveProperty('transferTwinCount');
      }
      expect(transactionsQuery.findTransactions).not.toHaveBeenCalled();
    });

    it('counts the splits, refund links, subscription links and portfolio transfer that go with a transaction', async () => {
      jest
        .mocked(transactionsQuery.findOneTransaction)
        .mockResolvedValue(
          record({ id: ID, transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio }) as never,
        );
      const splits = jest.spyOn(TransactionSplits, 'count').mockResolvedValue(2);
      const refunds = jest.spyOn(RefundTransactions, 'count').mockResolvedValue(3);
      const subscriptions = jest.spyOn(SubscriptionTransactions, 'count').mockResolvedValue(1);
      const portfolioTransfers = jest.spyOn(PortfolioTransfers, 'count').mockResolvedValue(1);

      const loaded = await load({ kind: 'transaction', targets: [ID] });

      expect(loaded?.counts).toEqual({
        splitCount: 2,
        refundLinkCount: 3,
        subscriptionLinkCount: 1,
        portfolioTransferCount: 1,
      });
      expect(whereOf(splits).where).toEqual({ transactionId: ID });
      expect(whereOf(refunds).where).toEqual({ [Op.or]: [{ originalTxId: ID }, { refundTxId: ID }] });
      expect(whereOf(subscriptions).where).toEqual({ transactionId: ID });
      expect(whereOf(portfolioTransfers).where).toEqual({ transactionId: ID });
    });

    it('lists no count a transaction has none of', async () => {
      jest.mocked(transactionsQuery.findOneTransaction).mockResolvedValue(record({ id: ID }) as never);

      expect((await load({ kind: 'transaction', targets: [ID] }))?.counts).toEqual({});
    });
  });

  describe('other rows a delete or update takes with its target', () => {
    it('counts the transactions and periods a subscription delete unlinks', async () => {
      jest.spyOn(Subscriptions, 'findOne').mockResolvedValue(record({ id: ID }) as never);
      const links = jest.spyOn(SubscriptionTransactions, 'count').mockResolvedValue(6);
      const periods = jest.spyOn(SubscriptionPeriods, 'count').mockResolvedValue(4);
      jest.spyOn(SubscriptionTags, 'findAll').mockResolvedValue([]);

      const loaded = await load({ kind: 'subscription', targets: [ID] });

      expect(whereOf(links).where).toEqual({ subscriptionId: ID });
      expect(whereOf(periods).where).toEqual({ subscriptionId: ID });
      expect(loaded?.counts).toEqual({ linkedTransactionCount: 6, periodCount: 4 });
    });

    it('adds the tags of a subscription to its row, so an update shows the set it replaces', async () => {
      jest.spyOn(Subscriptions, 'findOne').mockResolvedValue(record({ id: ID }) as never);
      jest.spyOn(SubscriptionTransactions, 'count').mockResolvedValue(0);
      jest.spyOn(SubscriptionPeriods, 'count').mockResolvedValue(0);
      jest.spyOn(SubscriptionTags, 'findAll').mockResolvedValue([
        { subscriptionId: ID, tagId: 'tag-b' },
        { subscriptionId: ID, tagId: 'tag-a' },
      ] as never);

      const loaded = await load({ kind: 'subscription', targets: [ID] });

      expect(loaded?.row?.tagIds).toEqual(['tag-a', 'tag-b']);
    });

    it('counts the assignments and categories a budget plan line delete cascades', async () => {
      jest.spyOn(BudgetPlans, 'findOne').mockResolvedValue(record({ id: ID }) as never);
      jest.spyOn(BudgetLines, 'findOne').mockResolvedValue(record({ id: OTHER }) as never);
      const assignments = jest.spyOn(BudgetAssignments, 'count').mockResolvedValue(12);
      const categories = jest.spyOn(BudgetLineCategories, 'count').mockResolvedValue(2);

      const loaded = await load({ kind: 'budgetPlanLine', targets: [ID, OTHER] });

      expect(whereOf(assignments).where).toEqual({ lineId: OTHER });
      expect(whereOf(categories).where).toEqual({ lineId: OTHER });
      expect(loaded?.counts).toEqual({ assignmentCount: 12, categoryCount: 2 });
    });

    it('counts the account transaction a portfolio transfer delete removes with it, only when asked to', async () => {
      jest.spyOn(PortfolioTransfers, 'findOne').mockResolvedValue(record({ id: ID, transactionId: OTHER }) as never);
      const run = (args: Record<string, unknown>) =>
        ENTITY_LOADERS.portfolioTransfer!({ userId: USER, targets: [ID], args });

      expect(await run({ deleteLinkedTransaction: true })).toMatchObject({
        counts: { linkedTransactionCount: 1 },
        removes: 1,
      });
      expect(await run({ deleteLinkedTransaction: false })).toMatchObject({ counts: {}, removes: 0 });
      expect(await run({})).toMatchObject({ counts: {}, removes: 0 });

      jest.spyOn(PortfolioTransfers, 'findOne').mockResolvedValue(record({ id: ID, transactionId: null }) as never);
      expect(await run({ deleteLinkedTransaction: true })).toMatchObject({ counts: {}, removes: 0 });
    });
  });

  describe('lock order', () => {
    const PLAN_LOCK = 'NO KEY UPDATE';
    const inTransaction = <T>(fn: () => Promise<T>) =>
      namespace.runAndReturn(async () => {
        namespace.set('transaction', { LOCK: { NO_KEY_UPDATE: PLAN_LOCK } });
        return fn();
      });

    const lockedLoad = ({ kind, targets }: { kind: string; targets: string[] }) =>
      inTransaction(() =>
        (ENTITY_LOADERS as Record<string, NonNullable<(typeof ENTITY_LOADERS)[keyof typeof ENTITY_LOADERS]>>)[kind]!({
          userId: USER,
          targets,
          lock: true,
        }),
      );

    it.each([
      { kind: 'budgetPlanLine', model: BudgetLines, targets: [ID, OTHER] },
      { kind: 'budgetPlanGroup', model: BudgetLineGroups, targets: [ID, OTHER] },
      { kind: 'budgetPlanLineGoal', model: BudgetLineGoals, targets: [ID, OTHER] },
    ])('locks the plan of a $kind before its own row, as the budget services do', async ({ kind, model, targets }) => {
      const plan = jest.spyOn(BudgetPlans, 'findOne').mockResolvedValue(record({ id: ID }) as never);
      const line = jest.spyOn(BudgetLines, 'findOne').mockResolvedValue(record({ id: OTHER }) as never);
      const own = (
        model === BudgetLines ? line : jest.spyOn(model as never as typeof BudgetLines, 'findOne')
      ).mockResolvedValue(record({ id: OTHER }) as never);
      jest.spyOn(BudgetAssignments, 'count').mockResolvedValue(0);
      jest.spyOn(BudgetLineCategories, 'count').mockResolvedValue(0);

      await lockedLoad({ kind, targets });

      expect(plan.mock.calls[0]![0]).toMatchObject({ lock: PLAN_LOCK } as never);
      expect(own.mock.calls[0]![0]).toMatchObject({ lock: true } as never);
      expect(plan.mock.invocationCallOrder[0]).toBeLessThan(own.mock.invocationCallOrder[0]!);
    });

    it('locks a budget plan the way the plan services do, not harder', async () => {
      const plan = jest.spyOn(BudgetPlans, 'findOne').mockResolvedValue(record({ id: ID }) as never);
      jest.spyOn(BudgetLines, 'count').mockResolvedValue(0);

      await lockedLoad({ kind: 'budgetPlan', targets: [ID] });

      expect(plan.mock.calls[0]![0]).toMatchObject({ lock: PLAN_LOCK, where: { id: ID, userId: USER } } as never);
    });

    it('leaves the plan unlocked when the preview is not under approval', async () => {
      const plan = jest.spyOn(BudgetPlans, 'findOne').mockResolvedValue(record({ id: ID }) as never);
      jest.spyOn(BudgetLines, 'findOne').mockResolvedValue(record({ id: OTHER }) as never);
      jest.spyOn(BudgetAssignments, 'count').mockResolvedValue(0);
      jest.spyOn(BudgetLineCategories, 'count').mockResolvedValue(0);

      await load({ kind: 'budgetPlanLine', targets: [ID, OTHER] });

      expect((plan.mock.calls[0]![0] as any).lock).toBeUndefined();
    });
  });

  it('leaves out the internal columns of a row', async () => {
    jest
      .spyOn(Accounts, 'findOne')
      .mockResolvedValue(record({ id: ID, externalData: { secret: 1 }, metaData: { a: 1 }, name: 'Cash' }) as never);

    const loaded = await load({ kind: 'account', targets: [ID] });

    expect(Object.keys(loaded!.row!)).not.toContain('externalData');
    expect(Object.keys(loaded!.row!)).not.toContain('metaData');
    expect(loaded!.row!.name).toBe('Cash');
  });
});
