import { describe, expect, it } from 'vitest';

import { OTHERS_SLICE_ID, foldSmallSlices } from './fold-small-slices';

const slice = (id: string, amount: number) => ({ categoryId: id, name: id, color: '#000', amount });

describe('foldSmallSlices', () => {
  it('folds every slice under the share into one', () => {
    const result = foldSmallSlices({
      slices: [slice('a', 90), slice('b', 6), slice('c', 3), slice('d', 1)],
      minShare: 0.05,
      othersName: 'Others',
    });
    expect(result.map((s) => [s.categoryId, s.amount])).toEqual([
      ['a', 90],
      ['b', 6],
      [OTHERS_SLICE_ID, 4],
    ]);
  });

  it('keeps a single small slice as it is', () => {
    const slices = [slice('a', 97), slice('b', 3)];
    expect(foldSmallSlices({ slices, minShare: 0.05, othersName: 'Others' })).toBe(slices);
  });

  it('keeps a slice sitting exactly at the share', () => {
    const result = foldSmallSlices({
      slices: [slice('a', 90), slice('b', 5), slice('c', 3), slice('d', 2)],
      minShare: 0.05,
      othersName: 'Others',
    });
    expect(result.map((s) => [s.categoryId, s.amount])).toEqual([
      ['a', 90],
      ['b', 5],
      [OTHERS_SLICE_ID, 5],
    ]);
  });

  it('keeps the slices as is when every slice is under the share', () => {
    const result = foldSmallSlices({
      slices: [slice('a', 25), slice('b', 25), slice('c', 25), slice('d', 25)],
      minShare: 0.3,
      othersName: 'Others',
    });
    expect(result.map((s) => s.categoryId)).toEqual(['a', 'b', 'c', 'd']);
  });
});
