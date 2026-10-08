import { describe, expect, it } from 'vitest';

import { readCategorySort, sortCategoryRows } from './sort-category-rows';

const rows = [
  { id: 'groceries', netAmount: -50 },
  { id: 'salary', netAmount: 200 },
  { id: 'rent', netAmount: -900 },
  { id: 'idle', netAmount: 0 },
];

const ids = ({ sortBy }: { sortBy: Parameters<typeof sortCategoryRows>[0]['sortBy'] }) =>
  sortCategoryRows({ rows, sortBy }).map((row) => row.id);

describe('sortCategoryRows', () => {
  it('keeps the user order for custom', () => {
    expect(ids({ sortBy: 'custom' })).toEqual(['groceries', 'salary', 'rent', 'idle']);
  });

  it('puts the biggest spend first for spend-desc', () => {
    expect(ids({ sortBy: 'spend-desc' })).toEqual(['rent', 'groceries', 'idle', 'salary']);
  });

  it('puts the smallest spend first for spend-asc', () => {
    expect(ids({ sortBy: 'spend-asc' })).toEqual(['salary', 'idle', 'groceries', 'rent']);
  });

  it('keeps the user order among equal amounts', () => {
    const tied = [
      { id: 'a', netAmount: 0 },
      { id: 'b', netAmount: -10 },
      { id: 'c', netAmount: 0 },
    ];

    expect(sortCategoryRows({ rows: tied, sortBy: 'spend-desc' }).map((row) => row.id)).toEqual(['b', 'a', 'c']);
    expect(sortCategoryRows({ rows: tied, sortBy: 'spend-asc' }).map((row) => row.id)).toEqual(['a', 'c', 'b']);
  });

  it('does not mutate the input', () => {
    sortCategoryRows({ rows, sortBy: 'spend-desc' });
    expect(rows[0]!.id).toBe('groceries');
  });
});

describe('readCategorySort', () => {
  it('falls back to custom for a missing or unknown value', () => {
    expect(readCategorySort({ config: undefined })).toBe('custom');
    expect(readCategorySort({ config: { sortBy: 'nope' } })).toBe('custom');
  });

  it('reads a stored value', () => {
    expect(readCategorySort({ config: { sortBy: 'spend-asc' } })).toBe('spend-asc');
  });
});
