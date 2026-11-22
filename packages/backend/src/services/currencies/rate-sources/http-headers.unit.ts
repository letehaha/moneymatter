import { encryptToken } from '@common/utils/encryption';
import { describe, expect, it } from '@jest/globals';

import { decryptHttpHeaders, encryptHttpHeaders } from './http-headers';

/** Swaps the last hex digit for a different one, so the value always changes (a fixed suffix would not when it already ends in it). */
const alteredLastDigit = (hex: string) => `${hex.slice(0, -1)}${hex.endsWith('0') ? '1' : '0'}`;

describe('http source headers at rest', () => {
  it('round-trips headers and keeps the values out of the stored string', () => {
    const headers = { 'X-Api-Key': 'super-secret-key', Authorization: 'Bearer token-123' };

    const encrypted = encryptHttpHeaders({ headers });

    expect(encrypted).not.toBeNull();
    expect(encrypted).not.toContain('super-secret-key');
    expect(encrypted).not.toContain('X-Api-Key');
    expect(decryptHttpHeaders({ encrypted })).toEqual(headers);
  });

  it('encrypts the same headers to a different string each time', () => {
    const headers = { 'X-Key': 'k' };

    expect(encryptHttpHeaders({ headers })).not.toBe(encryptHttpHeaders({ headers }));
  });

  it('stores nothing for no headers, and reads nothing as no headers', () => {
    expect(encryptHttpHeaders({ headers: {} })).toBeNull();
    expect(decryptHttpHeaders({ encrypted: null })).toEqual({});
  });

  it.each([
    ['text that is not ciphertext', 'plain'],
    ['ciphertext that was altered', alteredLastDigit(encryptHttpHeaders({ headers: { 'X-Key': 'k' } })!)],
    ['ciphertext of something that is not headers', encryptToken('[1,2]')],
    ['ciphertext of a header this API refuses', encryptToken(JSON.stringify({ Host: 'internal' }))],
  ])('reports %s as unreadable', (_name, encrypted) => {
    expect(decryptHttpHeaders({ encrypted })).toBeNull();
  });
});
