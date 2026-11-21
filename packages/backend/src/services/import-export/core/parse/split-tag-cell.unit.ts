import { describe, expect, it } from '@jest/globals';

import { splitTagCell } from './split-tag-cell';

describe('splitTagCell', () => {
  it('splits a comma-separated cell into individual trimmed names', () => {
    expect(splitTagCell('food, travel')).toEqual(['food', 'travel']);
  });

  it('splits on semicolons as well as commas', () => {
    expect(splitTagCell('Trip to Europe 2026; food, travel')).toEqual(['Trip to Europe 2026', 'food', 'travel']);
    expect(splitTagCell(';a;, b,;')).toEqual(['a', 'b']);
  });

  it('drops empty segments produced by stray or trailing commas', () => {
    expect(splitTagCell('food,, travel,')).toEqual(['food', 'travel']);
  });

  it('trims surrounding whitespace on each segment', () => {
    expect(splitTagCell('  food  ,  travel  ')).toEqual(['food', 'travel']);
  });

  it('returns an empty array for an empty or whitespace-only cell', () => {
    expect(splitTagCell('')).toEqual([]);
    expect(splitTagCell('   ')).toEqual([]);
    expect(splitTagCell(undefined)).toEqual([]);
  });

  it('returns an empty array for a null cell (null is falsy, same path as undefined)', () => {
    // The signature accepts `string | undefined | null`; null must be handled
    // identically to undefined — both hit the `if (!cell) return []` guard.
    expect(splitTagCell(null)).toEqual([]);
  });

  it('preserves internal spaces and duplicate names (dedupe happens later)', () => {
    expect(splitTagCell('eating out, eating out, gift card')).toEqual(['eating out', 'eating out', 'gift card']);
  });
});
