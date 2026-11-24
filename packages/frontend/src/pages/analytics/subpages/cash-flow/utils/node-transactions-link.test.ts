import { ROUTES_NAMES } from '@/routes/constants';
import { TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { CASH_NODE_ID, DEFICIT_NODE_ID, OTHER_NODE_ID } from './build-money-flow';
import { type MoneyFlowNodeKind, buildNodeTransactionsLink } from './node-transactions-link';

const categories = [
  { id: 'food', parentId: null },
  { id: 'groceries', parentId: 'food' },
  { id: 'fruit', parentId: 'groceries' },
  { id: 'salary', parentId: null },
  { id: 'housing', parentId: null },
];

const period = { from: new Date('2026-05-01T00:00:00.000Z'), to: new Date('2026-05-31T23:59:59.999Z') };

describe('buildNodeTransactionsLink', () => {
  it.each([OTHER_NODE_ID, CASH_NODE_ID, DEFICIT_NODE_ID, 'portfolio-1'])(
    'returns null for non-category node %s',
    (id) => {
      expect(buildNodeTransactionsLink({ nodeId: id, kind: 'expense', categories, period })).toBeNull();
    },
  );

  it('links an expense node to its whole subtree for the period', () => {
    expect(buildNodeTransactionsLink({ nodeId: 'food', kind: 'expense', categories, period })).toEqual({
      name: ROUTES_NAMES.transactions,
      query: {
        categoryIds: ['food', 'groceries', 'fruit'],
        start: '2026-05-01T00:00:00.000Z',
        end: '2026-05-31T23:59:59.999Z',
        transactionType: TRANSACTION_TYPES.expense,
      },
    });
  });

  it('filters income nodes by the income type', () => {
    const link = buildNodeTransactionsLink({ nodeId: 'salary', kind: 'income', categories, period });
    expect(link?.query).toMatchObject({ categoryIds: ['salary'], transactionType: TRANSACTION_TYPES.income });
  });

  it('leaves savings nodes unfiltered by type', () => {
    const link = buildNodeTransactionsLink({ nodeId: 'groceries', kind: 'savings', categories, period });
    expect(link?.query).toEqual({
      categoryIds: ['groceries', 'fruit'],
      start: '2026-05-01T00:00:00.000Z',
      end: '2026-05-31T23:59:59.999Z',
    });
  });

  describe('tax and savings descendants', () => {
    const home = [
      { id: 'home', parentId: null },
      { id: 'rent', parentId: 'home' },
      { id: 'property-tax', parentId: 'home' },
      { id: 'land-tax', parentId: 'property-tax' },
      { id: 'home-fund', parentId: 'home' },
    ];
    const ids = { taxCategoryIds: ['property-tax', 'land-tax'], savingsCategoryIds: ['home-fund'] };
    const categoryIdsFor = ({ nodeId, kind }: { nodeId: string; kind: MoneyFlowNodeKind }) =>
      buildNodeTransactionsLink({ nodeId, kind, categories: home, period, ...ids })?.query?.categoryIds;

    it('leaves them out of an expense node', () => {
      expect(categoryIdsFor({ nodeId: 'home', kind: 'expense' })).toEqual(['home', 'rent']);
    });

    it('keeps tax categories in an income node, since tax refunds stay income', () => {
      expect(categoryIdsFor({ nodeId: 'home', kind: 'income' })).toEqual(['home', 'rent', 'property-tax', 'land-tax']);
    });

    it('keeps its own tax descendants in a tax node', () => {
      const link = buildNodeTransactionsLink({ nodeId: 'property-tax', kind: 'tax', categories: home, period, ...ids });
      expect(link?.query).toMatchObject({
        categoryIds: ['property-tax', 'land-tax'],
        transactionType: TRANSACTION_TYPES.expense,
      });
    });
  });

  describe('grouped levels', () => {
    const categoryIdsAt = ({ nodeId, level }: { nodeId: string; level: number }) =>
      buildNodeTransactionsLink({ nodeId, kind: 'expense', level, categories, period })?.query?.categoryIds;

    it('links only the category itself when the node sits above the level', () => {
      expect(categoryIdsAt({ nodeId: 'food', level: 2 })).toEqual(['food']);
      expect(categoryIdsAt({ nodeId: 'groceries', level: 3 })).toEqual(['groceries']);
    });

    it('links the subtree when the node sits at the level', () => {
      expect(categoryIdsAt({ nodeId: 'groceries', level: 2 })).toEqual(['groceries', 'fruit']);
      expect(categoryIdsAt({ nodeId: 'food', level: 1 })).toEqual(['food', 'groceries', 'fruit']);
    });
  });
});
