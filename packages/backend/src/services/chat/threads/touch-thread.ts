import type { ChatUsage } from '@bt/shared/types';
import ChatThreads from '@models/chat-threads.model';
import { withTransaction } from '@services/common/with-transaction';

import { getChatRetentionDays } from './retention.service';
import { computeThreadExpiry } from './thread-expiry';

/**
 * Records that a message was just added to a thread: `lastMessageAt` moves to now, `expiresAt` follows
 * from the user's retention, the usage of a finished run is added to the thread's counters and an
 * untitled thread gets its title. The settings row is locked before the thread row, the order
 * `PUT /chat/settings` follows, so a retention change cannot interleave with this write.
 *
 * Returns false when the thread is gone (deleted while its run was still going).
 */
export const touchThread = withTransaction(
  async ({
    userId,
    threadId,
    usage,
    title,
  }: {
    userId: number;
    threadId: string;
    usage?: ChatUsage;
    /** Applied only while the thread is untitled and its title is automatic. */
    title?: string;
  }): Promise<boolean> => {
    const retentionDays = await getChatRetentionDays({ userId, lock: true });
    const thread = await ChatThreads.findOne({ where: { id: threadId, userId }, lock: true });
    if (!thread) return false;

    const lastMessageAt = new Date();
    await thread.update({
      lastMessageAt,
      expiresAt: computeThreadExpiry({ lastMessageAt, pinned: thread.pinned, retentionDays }),
      ...(title && thread.titleSource === 'auto' && thread.title === '' ? { title } : {}),
      ...(usage
        ? {
            // BIGINT comes back as a string; the row is locked, so the sum cannot be raced.
            inputTokens: Number(thread.inputTokens) + usage.inputTokens,
            outputTokens: Number(thread.outputTokens) + usage.outputTokens,
            cachedInputTokens: Number(thread.cachedInputTokens) + usage.cachedInputTokens,
          }
        : {}),
    });

    return true;
  },
);
