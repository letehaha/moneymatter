import {
  ACCOUNT_STATUSES,
  type GoalInsights,
  type GoalModel,
  type RecordId,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import type { AccountApiResponse } from '@root/serializers/accounts.serializer';
import type { TransactionApiResponse } from '@root/serializers/transactions.serializer';

import {
  type SubscriptionDetailForMcp,
  slimAccountDetailForMcp,
  slimAccountsForMcp,
  slimGoalsForMcp,
  slimSubscriptionDetailForMcp,
  slimTransactionsForMcp,
} from './serializers';

const fullAccount: AccountApiResponse = {
  id: 'acc-1',
  name: 'Checking',
  initialBalance: 100,
  refInitialBalance: 100,
  currentBalance: 250.5,
  refCurrentBalance: 230.25,
  creditLimit: 0,
  refCreditLimit: 0,
  type: 'system',
  accountCategory: 'general',
  currencyCode: 'USD',
  userId: 42,
  externalId: 'ext-abc',
  status: ACCOUNT_STATUSES.active,
  excludeFromStats: false,
  bankDataProviderConnectionId: 'conn-1',
  bankProviderType: null,
  logoDomain: null,
  logoInitials: null,
  logoColor: null,
  logoIcon: null,
  logoImageId: null,
  needsRelink: true,
  share: { isOwner: true } as AccountApiResponse['share'],
};

const fullTransaction: TransactionApiResponse = {
  id: 'tx-1',
  amount: 12.34,
  refAmount: 11.5,
  commissionRate: 0,
  refCommissionRate: 0,
  cashbackAmount: 0,
  originalAmount: 5000,
  originalCurrencyCode: 'JPY',
  note: 'Coffee',
  externalUrl: null,
  externalReference: null,
  location: null,
  time: new Date('2026-01-01T10:00:00.000Z'),
  userId: 42,
  transactionType: TRANSACTION_TYPES.expense,
  paymentType: 'creditCard',
  accountId: 'acc-1',
  categoryId: 'cat-1',
  currencyCode: 'USD',
  accountType: 'system',
  refCurrencyCode: 'EUR',
  transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
  transferId: null,
  originalId: 'orig-1',
  refundLinked: false,
  isPlanned: false,
  plannedMerge: null,
  isPending: false,
  payeeId: null,
  payeeLocked: false,
  categorizationMeta: null,
  createdAt: new Date('2026-01-01T10:00:00.000Z'),
  updatedAt: new Date('2026-01-02T10:00:00.000Z'),
  tags: [{ id: 'tag-1', name: 'food', color: '#fff', icon: 'cup' }],
  splits: [{ id: 'split-1', categoryId: 'cat-2', amount: 12.34, refAmount: 11.5, note: 'half' }],
  transactionGroups: [{ id: 'grp-1', name: 'Trip', transactionCount: 2 }],
};

describe('MCP serializers', () => {
  describe('slimAccountsForMcp', () => {
    it('keeps only AI-relevant account fields', () => {
      const slim = slimAccountsForMcp([fullAccount])[0]!;
      expect(Object.keys(slim).toSorted()).toEqual(
        [
          'accountCategory',
          'creditLimit',
          'currencyCode',
          'currentBalance',
          'excludeFromStats',
          'id',
          'name',
          'refCreditLimit',
          'refCurrentBalance',
          'status',
          'type',
        ].toSorted(),
      );
    });

    it('drops bank-sync metadata, ACL and audit fields', () => {
      const slim = (slimAccountsForMcp([fullAccount]) as unknown as Record<string, unknown>[])[0]!;
      for (const dropped of [
        'userId',
        'externalId',
        'bankDataProviderConnectionId',
        'bankProviderType',
        'needsRelink',
        'share',
        'initialBalance',
        'refInitialBalance',
      ]) {
        expect(slim).not.toHaveProperty(dropped);
      }
    });
  });

  describe('slimAccountDetailForMcp', () => {
    it('adds the opening balance, bank link and logo to the list fields', () => {
      const slim = slimAccountDetailForMcp(fullAccount);
      expect(slim).toMatchObject({
        id: 'acc-1',
        currentBalance: 250.5,
        initialBalance: 100,
        refInitialBalance: 100,
        bankDataProviderConnectionId: 'conn-1',
        needsRelink: true,
        logoDomain: null,
      });
    });

    it('drops the owner id and the external id', () => {
      const slim = slimAccountDetailForMcp(fullAccount) as unknown as Record<string, unknown>;
      for (const dropped of ['userId', 'externalId']) {
        expect(slim).not.toHaveProperty(dropped);
      }
    });
  });

  describe('slimTransactionsForMcp', () => {
    it('keeps only AI-relevant transaction fields', () => {
      const slim = slimTransactionsForMcp([fullTransaction])[0]!;
      expect(Object.keys(slim).toSorted()).toEqual(
        [
          'accountId',
          'amount',
          'categoryId',
          'currencyCode',
          'id',
          'isPlanned',
          'note',
          'refAmount',
          'splits',
          'tags',
          'time',
          'transactionGroups',
          'transactionType',
          'transferNature',
        ].toSorted(),
      );
    });

    it('drops fee, internal, audit and bank-blob fields', () => {
      const slim = (slimTransactionsForMcp([fullTransaction]) as unknown as Record<string, unknown>[])[0]!;
      for (const dropped of [
        'userId',
        'paymentType',
        'accountType',
        'refCurrencyCode',
        'transferId',
        'originalId',
        'commissionRate',
        'refCommissionRate',
        'cashbackAmount',
        'refundLinked',
        'createdAt',
        'updatedAt',
      ]) {
        expect(slim).not.toHaveProperty(dropped);
      }
    });

    it('slims embedded tags to id+name and splits to category/amount/note', () => {
      const slim = slimTransactionsForMcp([fullTransaction])[0]!;
      expect(slim.tags).toEqual([{ id: 'tag-1', name: 'food' }]);
      expect(slim.splits).toEqual([{ categoryId: 'cat-2', amount: 12.34, note: 'half' }]);
    });

    it('omits embedded collections when absent', () => {
      const { tags, splits, transactionGroups, ...noCollections } = fullTransaction;
      void tags;
      void splits;
      void transactionGroups;
      const slim = (slimTransactionsForMcp([noCollections]) as unknown as Record<string, unknown>[])[0]!;
      expect(slim).not.toHaveProperty('tags');
      expect(slim).not.toHaveProperty('splits');
      expect(slim).not.toHaveProperty('transactionGroups');
    });
  });

  describe('slimSubscriptionDetailForMcp', () => {
    // Cast mirrors the tool: the service hands back a loosely-typed toJSON blob
    // carrying matchingRules/userId/timestamps/bare FKs and category color/icon.
    const fullSubscription = {
      id: 'sub-1',
      userId: 42,
      name: 'Netflix',
      type: 'subscription',
      expectedAmount: 15.99,
      expectedCurrencyCode: 'USD',
      frequency: 'monthly',
      startDate: '2026-01-01',
      endDate: null,
      accountId: 'acc-1',
      categoryId: 'cat-1',
      matchingRules: { merchant: 'NETFLIX', amountTolerance: 0.1 },
      isActive: true,
      notes: 'family plan',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      account: { id: 'acc-1', name: 'Checking', currencyCode: 'USD' },
      category: { id: 'cat-1', name: 'Entertainment', color: '#fff', icon: 'tv' },
      nextExpectedDate: '2026-02-01',
      transactions: [
        {
          id: 'tx-1',
          time: '2026-01-05T00:00:00.000Z',
          amount: 15.99,
          refAmount: 14.5,
          commissionRate: 0,
          cashbackAmount: 0,
          note: 'Netflix',
          userId: 42,
          transactionType: 'expense',
          paymentType: 'creditCard',
          accountId: 'acc-1',
          categoryId: 'cat-1',
          currencyCode: 'USD',
          externalData: { raw: 'BLOB' },
          createdAt: '2026-01-05T00:00:00.000Z',
          SubscriptionTransactions: { matchSource: 'auto', matchedAt: '2026-01-05T01:00:00.000Z', status: 'active' },
        },
      ],
    } as unknown as SubscriptionDetailForMcp;

    it('drops subscription-level internal fields and category color/icon', () => {
      const slim = slimSubscriptionDetailForMcp(fullSubscription) as unknown as Record<string, unknown>;
      for (const dropped of ['userId', 'matchingRules', 'accountId', 'categoryId', 'createdAt', 'updatedAt']) {
        expect(slim).not.toHaveProperty(dropped);
      }
      expect(slim.category).toEqual({ id: 'cat-1', name: 'Entertainment' });
      expect(slim.account).toEqual({ id: 'acc-1', name: 'Checking', currencyCode: 'USD' });
    });

    it('slims each linked transaction and surfaces junction match metadata', () => {
      const slim = slimSubscriptionDetailForMcp(fullSubscription);
      expect(slim.transactions).toEqual([
        {
          id: 'tx-1',
          time: '2026-01-05T00:00:00.000Z',
          amount: 15.99,
          refAmount: 14.5,
          currencyCode: 'USD',
          note: 'Netflix',
          transactionType: 'expense',
          categoryId: 'cat-1',
          accountId: 'acc-1',
          matchSource: 'auto',
          matchedAt: '2026-01-05T01:00:00.000Z',
        },
      ]);
    });
  });

  describe('slimGoalsForMcp', () => {
    const accountId = 'acc-1' as RecordId;
    const insights = {
      status: 'behind',
      currentValue: 2000,
      remaining: 8000,
      monthEndValues: [1000, 1500, 2000],
      historicalPace: 400,
      historyMonths: 6,
      pace: 400,
      etaMonths: 20,
      neededMonthly: 1000,
      daysLeft: 240,
      input: {
        today: '2026-10-20',
        months: [],
        accounts: [],
        targetAmount: 10000,
        targetDate: null,
        plannedMonthly: null,
      },
      rateToBase: 2,
      baseCurrencyCode: 'UAH',
    } as GoalInsights;
    const goal = {
      id: 'goal-1',
      name: 'Car',
      currencyCode: 'USD',
      targetAmount: 5000,
      targetDate: '2027-06-20',
      plannedMonthly: null,
      status: 'active',
      achievedAt: null,
      achievedAmount: null,
      sortOrder: 0,
      reachedHoldDays: 30,
      logoDomain: null,
      accounts: [{ accountId, sharePercent: 50, fixedAmount: null, fixedPosition: null }],
      insights,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    } as unknown as GoalModel;

    it('converts insight amounts to the goal currency and names each account', () => {
      const [slim] = slimGoalsForMcp({ goals: [goal], accountNames: new Map([[accountId, 'Savings']]) });

      expect(slim).toEqual({
        id: 'goal-1',
        name: 'Car',
        status: 'active',
        currencyCode: 'USD',
        targetAmount: 5000,
        targetDate: '2027-06-20',
        plannedMonthly: null,
        achievedAt: null,
        achievedAmount: null,
        reachedHoldDays: 30,
        progress: {
          status: 'behind',
          currentValue: 1000,
          remaining: 4000,
          pace: 200,
          historicalPace: 200,
          neededMonthly: 500,
          etaMonths: 20,
          daysLeft: 240,
        },
        accounts: [{ accountId, accountName: 'Savings', sharePercent: 50, fixedAmount: null, fixedPosition: null }],
      });
    });

    it('drops the per-account history, logo and audit fields', () => {
      const slim = slimGoalsForMcp({ goals: [goal], accountNames: new Map() })[0];

      for (const dropped of ['insights', 'logoDomain', 'sortOrder', 'createdAt', 'updatedAt']) {
        expect(slim).not.toHaveProperty(dropped);
      }
      expect(JSON.stringify(slim)).not.toContain('monthEndValues');
    });

    it('keeps nulls for missing pace and unknown accounts', () => {
      const noPace = { ...insights, pace: null, historicalPace: null, etaMonths: null, neededMonthly: null };
      const [slim] = slimGoalsForMcp({ goals: [{ ...goal, insights: noPace }], accountNames: new Map() });

      expect(slim!.progress).toMatchObject({ pace: null, historicalPace: null, etaMonths: null, neededMonthly: null });
      expect(slim!.accounts).toEqual([
        { accountId, accountName: null, sharePercent: 50, fixedAmount: null, fixedPosition: null },
      ]);
    });

    it.each([
      { overrides: { status: 'paused' }, expected: 'paused' },
      { overrides: { achievedAt: '2026-10-01T00:00:00.000Z' }, expected: 'reached' },
    ])('reports the displayed status: $expected', ({ overrides, expected }) => {
      const [slim] = slimGoalsForMcp({ goals: [{ ...goal, ...overrides } as GoalModel], accountNames: new Map() });

      expect(slim!.progress!.status).toBe(expected);
    });

    it('returns null progress when the goal currency has no rate', () => {
      const [slim] = slimGoalsForMcp({ goals: [{ ...goal, insights: null }], accountNames: new Map() });

      expect(slim!.progress).toBeNull();
    });

    it('returns an empty list for no goals', () => {
      expect(slimGoalsForMcp({ goals: [], accountNames: new Map() })).toEqual([]);
    });
  });
});
