import type { TransactionGroupResponse } from '@/api/transaction-groups';
import { describe, expect, it } from 'vitest';

import { sortGroups } from './sort-groups';

const buildGroup = (overrides: Partial<TransactionGroupResponse>): TransactionGroupResponse => ({
  id: overrides.name ?? 'id',
  name: 'Group',
  note: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const groups = [
  buildGroup({ name: 'beta', dateFrom: '2026-03-01', dateTo: '2026-03-05', netRefAmount: -50 }),
  buildGroup({ name: 'Alpha', dateFrom: '2026-05-01', dateTo: '2026-05-01', netRefAmount: 200 }),
  buildGroup({ name: 'Gamma 10', dateFrom: '2026-01-10', dateTo: '2026-04-01', netRefAmount: 10 }),
  buildGroup({ name: 'Gamma 9', createdAt: '2026-02-01T00:00:00.000Z' }),
];

const names = (list: TransactionGroupResponse[]) => list.map((g) => g.name);

describe('sortGroups', () => {
  it('sorts by latest transaction date, falling back to createdAt', () => {
    expect(names(sortGroups({ groups, field: 'date', direction: 'desc' }))).toEqual([
      'Alpha',
      'Gamma 10',
      'beta',
      'Gamma 9',
    ]);
    expect(names(sortGroups({ groups, field: 'date', direction: 'asc' }))).toEqual([
      'Gamma 9',
      'beta',
      'Gamma 10',
      'Alpha',
    ]);
  });

  it('sorts by name case-insensitively with numeric awareness', () => {
    expect(names(sortGroups({ groups, field: 'name', direction: 'asc' }))).toEqual([
      'Alpha',
      'beta',
      'Gamma 9',
      'Gamma 10',
    ]);
    expect(names(sortGroups({ groups, field: 'name', direction: 'desc' }))).toEqual([
      'Gamma 10',
      'Gamma 9',
      'beta',
      'Alpha',
    ]);
  });

  it('sorts by net amount, treating a missing amount as zero', () => {
    expect(names(sortGroups({ groups, field: 'amount', direction: 'desc' }))).toEqual([
      'Alpha',
      'Gamma 10',
      'Gamma 9',
      'beta',
    ]);
    expect(names(sortGroups({ groups, field: 'amount', direction: 'asc' }))).toEqual([
      'beta',
      'Gamma 9',
      'Gamma 10',
      'Alpha',
    ]);
  });

  it('does not mutate the input', () => {
    const before = names(groups);
    sortGroups({ groups, field: 'name', direction: 'desc' });
    expect(names(groups)).toEqual(before);
  });
});
