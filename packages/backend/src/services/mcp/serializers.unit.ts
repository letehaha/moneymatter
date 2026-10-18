import { ACCOUNT_STATUSES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import type { AccountGroupApiResponse } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import type { AccountApiResponse } from '@root/serializers/accounts.serializer';
import type { TransactionApiResponse } from '@root/serializers/transactions.serializer';

import {
  type SubscriptionDetailForMcp,
  slimAccountDetailForMcp,
  slimAccountGroupForMcp,
  slimAccountGroupsForMcp,
  slimAccountsForMcp,
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
  refAmountMissing: false,
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

  describe('slimAccountGroupsForMcp', () => {
    const makeGroup = (patch: Partial<AccountGroupApiResponse>): AccountGroupApiResponse => ({
      id: 'g-root',
      name: 'Savings',
      userId: 42,
      parentGroupId: null,
      bankDataProviderConnectionId: null,
      logoDomain: null,
      logoInitials: 'SV',
      logoColor: '#ff0000',
      logoIcon: null,
      logoImageId: null,
      accounts: [fullAccount],
      childGroups: [],
      ...patch,
    });

    it('keeps the group fields, slims the accounts and child stubs, and drops the owner id', () => {
      const root = makeGroup({
        childGroups: [makeGroup({ id: 'g-child', name: 'Emergency', parentGroupId: 'g-root', accounts: [] })],
      });

      const [slim] = slimAccountGroupsForMcp([root]) as unknown as Record<string, unknown>[];

      expect(slim).toMatchObject({
        id: 'g-root',
        name: 'Savings',
        parentGroupId: null,
        path: 'Savings',
        logoInitials: 'SV',
        logoColor: '#ff0000',
        childGroups: [{ id: 'g-child', name: 'Emergency' }],
      });
      expect(slim).not.toHaveProperty('userId');
      expect((slim!.accounts as Record<string, unknown>[])[0]).toEqual(slimAccountsForMcp([fullAccount])[0]);
    });

    it('builds the path through every ancestor present in the list', () => {
      const groups = [
        makeGroup({ id: 'c', name: 'C', parentGroupId: 'b' }),
        makeGroup({ id: 'a', name: 'A' }),
        makeGroup({ id: 'b', name: 'B', parentGroupId: 'a' }),
      ];

      expect(slimAccountGroupsForMcp(groups).map((g) => g.path)).toEqual(['A > B > C', 'A', 'A > B']);
    });

    it('marks a path whose parent is not in the list (an account filter hides it)', () => {
      const [slim] = slimAccountGroupsForMcp([makeGroup({ id: 'c', name: 'C', parentGroupId: 'missing' })]);

      expect(slim!.path).toBe('… > C');
      expect(slim!.parentGroupId).toBe('missing');
    });

    it('survives a parent cycle', () => {
      const groups = [
        makeGroup({ id: 'a', name: 'A', parentGroupId: 'b' }),
        makeGroup({ id: 'b', name: 'B', parentGroupId: 'a' }),
      ];

      expect(slimAccountGroupsForMcp(groups).map((g) => g.path)).toEqual(['… > B > A', '… > A > B']);
    });
  });

  describe('slimAccountGroupForMcp', () => {
    it('keeps the group fields without accounts, children or a path', () => {
      const slim = slimAccountGroupForMcp({
        id: 'g-1',
        name: 'Savings',
        userId: 42,
        parentGroupId: 'g-0',
        bankDataProviderConnectionId: null,
        logoDomain: 'example.com',
        logoInitials: null,
        logoColor: null,
        logoIcon: null,
        logoImageId: null,
        accounts: [],
        childGroups: [],
      });

      expect(slim).toEqual({
        id: 'g-1',
        name: 'Savings',
        parentGroupId: 'g-0',
        bankDataProviderConnectionId: null,
        logoDomain: 'example.com',
        logoInitials: null,
        logoColor: null,
      });
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
});
