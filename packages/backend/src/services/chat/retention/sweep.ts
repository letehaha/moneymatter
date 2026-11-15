import ChatAttachments from '@models/chat-attachments.model';
import ChatProposals from '@models/chat-proposals.model';
import ChatThreads from '@models/chat-threads.model';
import { Op, literal } from 'sequelize';

import { expireAllDueCards } from '../proposals/card-expiry';

const DEFAULT_BATCH_SIZE = 200;
/** An attachment is uploaded first and sent with a message afterwards; one never sent within the hour is abandoned. */
const UNSENT_ATTACHMENT_MAX_AGE_MS = 60 * 60 * 1000;
/** A standalone approval finishes in seconds; one still `applying` after this long lost its process. */
const APPLYING_MAX_AGE_MS = 10 * 60 * 1000;

interface ChatRetentionResult {
  expiredCards: number;
  unknownCards: number;
  deletedAttachments: number;
  deletedThreads: number;
}

/**
 * A standalone card is claimed as `applying` before its handler runs and finished in a second
 * transaction. A crash in between leaves `applying`, and nothing re-runs it: the card becomes
 * `unknown`, which tells the user to check whether the change happened.
 */
async function markStuckApplyingUnknown({ batchSize }: { batchSize: number }): Promise<number> {
  let marked = 0;

  for (;;) {
    const stuck = await ChatProposals.findAll({
      where: { status: 'applying', decidedAt: { [Op.lte]: new Date(Date.now() - APPLYING_MAX_AGE_MS) } },
      attributes: ['id'],
      limit: batchSize,
    });
    if (stuck.length === 0) return marked;

    const [updated] = await ChatProposals.update(
      { status: 'unknown', statusReason: 'applyUnknown' },
      { where: { id: stuck.map((row) => row.id as string), status: 'applying' } },
    );
    marked += updated;
    if (stuck.length < batchSize) return marked;
  }
}

async function deleteUnsentAttachments({ batchSize }: { batchSize: number }): Promise<number> {
  let deleted = 0;

  for (;;) {
    const abandoned = await ChatAttachments.findAll({
      where: { messageId: null, createdAt: { [Op.lte]: new Date(Date.now() - UNSENT_ATTACHMENT_MAX_AGE_MS) } },
      attributes: ['id'],
      limit: batchSize,
    });
    if (abandoned.length === 0) return deleted;

    // The message id is checked again: a send that claimed the attachment since the read keeps it.
    deleted += await ChatAttachments.destroy({
      where: { id: abandoned.map((row) => row.id as string), messageId: null },
    });
    if (abandoned.length < batchSize) return deleted;
  }
}

/**
 * Deletes the threads past their retention end; their messages, cards (applied ones too) and
 * attachments follow through the FK cascade. A pinned thread has no expiry. A thread with a message
 * still streaming is left for a later run: the run's end moves the expiry forward, and a crashed run
 * is marked interrupted by the run sweep first.
 */
async function deleteExpiredThreads({ batchSize }: { batchSize: number }): Promise<number> {
  const noStreamingMessage = literal(
    `NOT EXISTS (SELECT 1 FROM "ChatMessages" WHERE "ChatMessages"."threadId" = "ChatThreads"."id" AND "ChatMessages"."status" = 'streaming')`,
  );
  const where = {
    pinned: false,
    expiresAt: { [Op.lte]: new Date() },
    [Op.and]: [noStreamingMessage],
  };
  let deleted = 0;

  for (;;) {
    const expired = await ChatThreads.findAll({ where, attributes: ['id'], limit: batchSize });
    if (expired.length === 0) return deleted;

    deleted += await ChatThreads.destroy({ where: { ...where, id: expired.map((row) => row.id as string) } });
    if (expired.length < batchSize) return deleted;
  }
}

/**
 * The hourly chat housekeeping: expire stale cards, flag approvals a crash left half-done, drop
 * attachments nobody sent and delete threads past their retention. Cards are handled first so the
 * counts describe cards that still exist, and threads last because deleting one removes its rows.
 */
export async function sweepChatRetention({
  batchSize = DEFAULT_BATCH_SIZE,
}: { batchSize?: number } = {}): Promise<ChatRetentionResult> {
  const expiredCards = await expireAllDueCards({ batchSize });
  const unknownCards = await markStuckApplyingUnknown({ batchSize });
  const deletedAttachments = await deleteUnsentAttachments({ batchSize });
  const deletedThreads = await deleteExpiredThreads({ batchSize });

  return { expiredCards, unknownCards, deletedAttachments, deletedThreads };
}
