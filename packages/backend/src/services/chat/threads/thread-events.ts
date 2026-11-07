import { SSE_EVENT_TYPES } from '@bt/shared/types';
import { sseManager } from '@services/common/sse';

/** Tells the user's other tabs to refresh their thread list. Not a run stream: it carries no content. */
export const notifyThreadUpdated = ({ userId, threadId }: { userId: number; threadId: string }): void => {
  sseManager.sendToUser({ userId, event: SSE_EVENT_TYPES.CHAT_THREAD_UPDATED, data: { threadId } });
};
