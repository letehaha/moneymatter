import { describe, expect, it } from 'vitest';

import { spreadTops } from './spread-tops';

describe('spreadTops', () => {
  it('centers each label on its box when nothing overlaps', () => {
    const tops = spreadTops({
      boxes: [
        { y0: 0, y1: 40 },
        { y0: 100, y1: 140 },
      ],
      heights: [20, 20],
      limit: 200,
    });

    expect(tops).toEqual([10, 110]);
  });

  it('pushes an overlapping label below the previous one', () => {
    const tops = spreadTops({
      boxes: [
        { y0: 0, y1: 40 },
        { y0: 40, y1: 50 },
        { y0: 50, y1: 60 },
      ],
      heights: [20, 20, 20],
      limit: 200,
    });

    expect(tops).toEqual([10, 35, 55]);
  });

  it('shifts the whole stack up when it runs past the limit', () => {
    const tops = spreadTops({
      boxes: [
        { y0: 80, y1: 90 },
        { y0: 90, y1: 100 },
      ],
      heights: [20, 20],
      limit: 100,
    });

    expect(tops).toEqual([60, 80]);
  });

  it('returns nothing for no boxes', () => {
    expect(spreadTops({ boxes: [], heights: [], limit: 100 })).toEqual([]);
  });
});
