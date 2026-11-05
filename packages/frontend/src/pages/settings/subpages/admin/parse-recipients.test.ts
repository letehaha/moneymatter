import { describe, expect, it } from 'vitest';

import { parseRecipients } from './parse-recipients';

describe('parseRecipients', () => {
  it('returns empty lists for blank input', () => {
    expect(parseRecipients('  \n ')).toEqual({ userIds: [], emails: [] });
  });

  it('splits ids and emails on commas and whitespace, deduping', () => {
    expect(parseRecipients('12, 45 Foo@Bar.com\n12,foo@bar.com;7')).toEqual({
      userIds: [12, 45, 7],
      emails: ['foo@bar.com'],
    });
  });

  it.each(['0', '-1', '1.5', '1e3', '0x10', '2147483648', 'abc', 'foo@bar'])('rejects "%s"', (token) => {
    expect(parseRecipients(`12, ${token}`)).toBeNull();
  });
});
