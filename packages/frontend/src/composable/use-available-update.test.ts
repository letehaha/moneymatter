import { describe, expect, it } from 'vitest';

import { isNewerVersion } from './use-available-update';

describe('isNewerVersion', () => {
  it.each([
    ['0.34.0', '0.33.1', true],
    ['0.10.0', '0.9.9', true],
    ['1.0.0', '0.99.0', true],
    ['0.33.1', '0.33.1', false],
    ['0.33.1', '0.34.0', false],
    ['0.9.9', '0.10.0', false],
  ])('latest %s vs current %s -> %s', (latest, current, expected) => {
    expect(isNewerVersion({ latest, current })).toBe(expected);
  });
});
