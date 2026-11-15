import type { ChatRetentionDays } from '@bt/shared/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * End of a thread's retention window, or null when it never expires: a pinned thread, or a user
 * whose retention is "never". Every writer of `expiresAt` goes through this rule (the bulk
 * recompute in `retention.service.ts` repeats it in SQL with the same arithmetic).
 */
export const computeThreadExpiry = ({
  lastMessageAt,
  pinned,
  retentionDays,
}: {
  lastMessageAt: Date;
  pinned: boolean;
  retentionDays: ChatRetentionDays | null;
}): Date | null => {
  if (pinned || retentionDays === null) return null;

  return new Date(lastMessageAt.getTime() + retentionDays * DAY_MS);
};
