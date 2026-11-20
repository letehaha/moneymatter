import { describe, expect, it } from '@jest/globals';

import { resolveBankLogoDomain } from './bank-institutions';

describe('resolveBankLogoDomain', () => {
  it.each([
    ['PKO Bank Polski', 'pkobp.pl'],
    ['mBank', 'mbank.pl'],
    ['Wise', 'wise.com'],
    ['transferwise', 'wise.com'],
  ])('resolves %s to %s', (bankName, domain) => {
    expect(resolveBankLogoDomain({ bankName })).toBe(domain);
  });

  it.each([['Nonexistent Bank XYZ 12345'], [''], ['   '], [null]])('returns null for %p', (bankName) => {
    expect(resolveBankLogoDomain({ bankName })).toBeNull();
  });
});
