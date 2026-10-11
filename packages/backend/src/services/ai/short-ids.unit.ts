import { describe, expect, it } from '@jest/globals';

import { createShortIds } from './short-ids';

describe('createShortIds', () => {
  it('numbers aliases in input order and resolves only the ones it issued', () => {
    const shortIds = createShortIds({ ids: ['uuid-a', 'uuid-b'], prefix: 'c' });

    expect(shortIds.aliasOf({ id: 'uuid-b' })).toBe('c2');
    expect(shortIds.aliasOf({ id: 'uuid-x' })).toBeUndefined();
    expect(shortIds.resolve({ aliases: ['c2', 'c1', 'c9', 'uuid-a'] })).toEqual(['uuid-b', 'uuid-a']);
  });
});
