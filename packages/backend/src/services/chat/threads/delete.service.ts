import { withTransaction } from '@services/common/with-transaction';

import { findThreadOrThrow } from './find-thread';
import { notifyThreadUpdated } from './thread-events';

// Messages, cards and attachments go with the thread through the FK cascade.
const deleteThreadTransactional = withTransaction(
  async ({ userId, threadId }: { userId: number; threadId: string }) => {
    const thread = await findThreadOrThrow({ userId, threadId });
    await thread.destroy();
  },
);

export const deleteThread = async ({ userId, threadId }: { userId: number; threadId: string }): Promise<void> => {
  await deleteThreadTransactional({ userId, threadId });
  notifyThreadUpdated({ userId, threadId });
};
