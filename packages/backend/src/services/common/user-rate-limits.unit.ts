import { describe, expect, it } from '@jest/globals';

import * as userRateLimits from './user-rate-limits';

const budgets = Object.entries(userRateLimits).filter(
  (entry): entry is [string, userRateLimits.UserRateLimit] =>
    typeof entry[1] === 'object' && entry[1] !== null && 'maxAttempts' in entry[1],
);

describe('user rate limits', () => {
  it('gives every budget its own counter key, so two budgets never draw from one count', () => {
    const keys = budgets.map(([, limit]) => limit.key({ userId: 7 }));

    expect(budgets.length).toBeGreaterThan(2);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keys a budget by user, so one user never spends another’s', () => {
    for (const [, limit] of budgets) {
      expect(limit.key({ userId: 1 })).not.toBe(limit.key({ userId: 2 }));
    }
  });

  it('allows 30 chat attachment uploads per 10 minutes', () => {
    expect(userRateLimits.CHAT_ATTACHMENT_LIMIT).toMatchObject({ windowSeconds: 600, maxAttempts: 30 });
    expect(userRateLimits.CHAT_ATTACHMENT_LIMIT.key({ userId: 7 })).toBe('chat-attachment:user:7');
  });
});
