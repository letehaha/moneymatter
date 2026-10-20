import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { sortSubscriptions, type SubscriptionSortBy } from './sort-subscriptions';

const FROZEN_NOW = new Date('2025-06-15T12:00:00Z');

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(FROZEN_NOW);
});
afterAll(() => {
  jest.useRealTimers();
});

function makeDefaults() {
  return {
    name: 'Item',
    nextDueDate: null as string | null,
    expectedAmount: null as number | null,
    createdAt: '2025-01-01T00:00:00Z' as Date | string,
  };
}
const make = (over: Partial<ReturnType<typeof makeDefaults>>) => ({ ...makeDefaults(), ...over });
const run = ({ items, sortBy }: { items: ReturnType<typeof makeDefaults>[]; sortBy: SubscriptionSortBy }) =>
  sortSubscriptions({ items, sortBy }).map((i) => i.name);

describe('sortSubscriptions', () => {
  describe('dueDate', () => {
    it('sorts ascending by nextDueDate with a past (overdue) date floating to the top', () => {
      const items = [
        make({ name: 'annual', nextDueDate: '2026-03-29' }),
        make({ name: 'overdue', nextDueDate: '2025-06-01' }),
        make({ name: 'soon', nextDueDate: '2025-06-20' }),
      ];
      expect(run({ items, sortBy: 'dueDate' })).toEqual(['overdue', 'soon', 'annual']);
    });

    it('pushes null nextDueDate to the end', () => {
      const items = [make({ name: 'noDate', nextDueDate: null }), make({ name: 'hasDate', nextDueDate: '2025-07-01' })];
      expect(run({ items, sortBy: 'dueDate' })).toEqual(['hasDate', 'noDate']);
    });

    it('breaks ties by name (case-insensitive)', () => {
      const items = [
        make({ name: 'beta', nextDueDate: '2025-07-01' }),
        make({ name: 'Alpha', nextDueDate: '2025-07-01' }),
      ];
      expect(run({ items, sortBy: 'dueDate' })).toEqual(['Alpha', 'beta']);
    });
  });

  describe('amount', () => {
    it('sorts descending by expectedAmount with nulls last', () => {
      const items = [
        make({ name: 'cheap', expectedAmount: 5 }),
        make({ name: 'none', expectedAmount: null }),
        make({ name: 'pricey', expectedAmount: 100 }),
      ];
      expect(run({ items, sortBy: 'amount' })).toEqual(['pricey', 'cheap', 'none']);
    });

    it('breaks amount ties by name', () => {
      const items = [make({ name: 'zeta', expectedAmount: 10 }), make({ name: 'alpha', expectedAmount: 10 })];
      expect(run({ items, sortBy: 'amount' })).toEqual(['alpha', 'zeta']);
    });
  });

  describe('name', () => {
    it('sorts ascending case-insensitively', () => {
      const items = [make({ name: 'banana' }), make({ name: 'Apple' }), make({ name: 'cherry' })];
      expect(run({ items, sortBy: 'name' })).toEqual(['Apple', 'banana', 'cherry']);
    });
  });

  describe('recent', () => {
    it('sorts by createdAt descending (newest first)', () => {
      const items = [
        make({ name: 'old', createdAt: '2025-01-01T00:00:00Z' }),
        make({ name: 'new', createdAt: '2025-06-01T00:00:00Z' }),
        make({ name: 'mid', createdAt: '2025-03-01T00:00:00Z' }),
      ];
      expect(run({ items, sortBy: 'recent' })).toEqual(['new', 'mid', 'old']);
    });
  });

  it('does not mutate the input array', () => {
    const items = [make({ name: 'b', nextDueDate: '2025-07-02' }), make({ name: 'a', nextDueDate: '2025-07-01' })];
    const before = items.map((i) => i.name);
    sortSubscriptions({ items, sortBy: 'dueDate' });
    expect(items.map((i) => i.name)).toEqual(before);
  });
});
