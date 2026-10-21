import { describe, expect, it } from '@jest/globals';

import { computeThreadExpiry } from './thread-expiry';

const lastMessageAt = new Date('2026-10-01T12:30:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('computeThreadExpiry', () => {
  it.each([7, 30, 90, 365] as const)('ends the window %s days after the last message', (retentionDays) => {
    const expiresAt = computeThreadExpiry({ lastMessageAt, pinned: false, retentionDays });

    expect(expiresAt?.getTime()).toBe(lastMessageAt.getTime() + retentionDays * DAY_MS);
  });

  it('never expires a pinned thread', () => {
    expect(computeThreadExpiry({ lastMessageAt, pinned: true, retentionDays: 7 })).toBeNull();
  });

  it('never expires a thread when retention is "never"', () => {
    expect(computeThreadExpiry({ lastMessageAt, pinned: false, retentionDays: null })).toBeNull();
  });

  it('does not mutate the date it is given', () => {
    const before = lastMessageAt.getTime();

    computeThreadExpiry({ lastMessageAt, pinned: false, retentionDays: 30 });

    expect(lastMessageAt.getTime()).toBe(before);
  });
});
