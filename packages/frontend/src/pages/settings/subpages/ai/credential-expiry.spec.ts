import { describe, expect, it } from 'vitest';

import { getCredentialExpiry } from './credential-expiry';

const NOW = new Date('2026-10-17T12:00:00.000Z');

describe('getCredentialExpiry', () => {
  it('has nothing to say without an expiry date', () => {
    expect(getCredentialExpiry({ expiresAt: undefined, now: NOW })).toBeNull();
  });

  it('ignores an unreadable date', () => {
    expect(getCredentialExpiry({ expiresAt: 'not-a-date', now: NOW })).toBeNull();
  });

  it('reads a far-off date as valid', () => {
    expect(getCredentialExpiry({ expiresAt: '2027-10-17T12:00:00.000Z', now: NOW })?.kind).toBe('valid');
  });

  it('warns once the date is within 14 days', () => {
    expect(getCredentialExpiry({ expiresAt: '2026-10-30T12:00:00.000Z', now: NOW })?.kind).toBe('expiring-soon');
  });

  it('is still valid at exactly 14 days out', () => {
    expect(getCredentialExpiry({ expiresAt: '2026-10-31T12:00:00.000Z', now: NOW })?.kind).toBe('valid');
  });

  it('reads a past date as expired', () => {
    expect(getCredentialExpiry({ expiresAt: '2026-10-01T00:00:00.000Z', now: NOW })?.kind).toBe('expired');
  });

  it('reads the current instant as expired', () => {
    expect(getCredentialExpiry({ expiresAt: NOW.toISOString(), now: NOW })?.kind).toBe('expired');
  });

  it('returns the parsed date', () => {
    expect(getCredentialExpiry({ expiresAt: '2027-10-17T12:00:00.000Z', now: NOW })?.expiresAt).toEqual(
      new Date('2027-10-17T12:00:00.000Z'),
    );
  });
});
