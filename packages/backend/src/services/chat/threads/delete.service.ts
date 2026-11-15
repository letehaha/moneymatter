import { withTransaction } from '@services/common/with-transaction';

import { cancelRunsOfThread, findStreamingRunIds } from '../runs/cancel';
import { findThreadOrThrow } from './find-thread';
import { notifyThreadUpdated } from './thread-events';

// Messages, cards and attachments go with the thread through the FK cascade.
const deleteThreadTransactional = withTransaction(
  async ({ userId, threadId }: { userId: number; threadId: string }) => {
    const thread = await findThreadOrThrow({ userId, threadId });
    const runIds = await findStreamingRunIds({ threadId });
    await thread.destroy();

    return runIds;
  },
);

export const deleteThread = async ({ userId, threadId }: { userId: number; threadId: string }): Promise<void> => {
  const runIds = await deleteThreadTransactional({ userId, threadId });
  // A run that is still going has nothing left to write to: it is stopped so it stops spending tokens.
  await cancelRunsOfThread({ runIds });
  notifyThreadUpdated({ userId, threadId });
};
