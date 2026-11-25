import { describe, expect, it } from 'vitest';

import { toOptionalNumber } from './use-hero-format';

describe('toOptionalNumber', () => {
  it.each([null, undefined, ''])('returns null for %j', (value) => {
    expect(toOptionalNumber({ value })).toBeNull();
  });

  it('returns null for a non-numeric string', () => {
    expect(toOptionalNumber({ value: 'abc' })).toBeNull();
  });

  it('parses zero', () => {
    expect(toOptionalNumber({ value: '0' })).toBe(0);
  });

  it('parses a decimal string', () => {
    expect(toOptionalNumber({ value: '12.5' })).toBe(12.5);
  });
});
