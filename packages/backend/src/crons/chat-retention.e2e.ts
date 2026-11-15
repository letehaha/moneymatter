import type { ChatAttachmentKind, ChatProposalStatus } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import ChatAttachments from '@models/chat-attachments.model';
import ChatMessages from '@models/chat-messages.model';
import ChatProposals from '@models/chat-proposals.model';
import ChatThreads from '@models/chat-threads.model';
import { chatRetentionCron } from '@root/crons/chat-retention';
import * as helpers from '@tests/helpers';
import { randomUUID } from 'node:crypto';

/** The sweeps have no HTTP surface of their own, so this e2e invokes the cron and reads the rows back. */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const ago = ({ ms }: { ms: number }) => new Date(Date.now() - ms);

interface SeedThreadParams {
  /** Moves the thread's retention end: `past` is expired, `future` is not, `none` is pinned or "never". */
  expiry: 'past' | 'future' | 'none';
  pinned?: boolean;
}

async function seedThread({ expiry, pinned = false }: SeedThreadParams) {
  const thread = await helpers.createChatThread({ raw: true });
  const userId = await helpers.getTestUserId();
  await ChatThreads.update(
    {
      pinned,
      lastMessageAt: ago({ ms: expiry === 'past' ? 60 * DAY_MS : MINUTE_MS }),
      expiresAt: expiry === 'none' ? null : expiry === 'past' ? ago({ ms: DAY_MS }) : new Date(Date.now() + DAY_MS),
    },
    { where: { id: thread.id } },
  );
  const message = await ChatMessages.create({
    threadId: thread.id,
    userId,
    role: 'assistant',
    status: 'complete',
    parts: [],
  });

  return { threadId: thread.id, userId, messageId: message.id as string };
}

async function seedCard({
  threadId,
  messageId,
  userId,
  status = 'pending',
  expiresAt,
  decidedAt = null,
}: {
  threadId: string;
  messageId: string;
  userId: number;
  status?: ChatProposalStatus;
  expiresAt: Date;
  decidedAt?: Date | null;
}) {
  const card = await ChatProposals.create({
    threadId,
    messageId,
    userId,
    toolName: 'create_category',
    proposedArgs: { name: 'Seeded' },
    args: { name: 'Seeded' },
    cardKind: 'create',
    entity: 'category',
    status,
    expiresAt,
    decidedAt,
    appliedAt: status === 'applied' ? new Date() : null,
  });

  return card.id as string;
}

async function seedAttachment({
  threadId,
  userId,
  sentWith,
  ageMs,
}: {
  threadId: string;
  userId: number;
  /** The message that carried the attachment; left out for one that was uploaded and never sent. */
  sentWith?: string;
  ageMs: number;
}) {
  const attachment = await ChatAttachments.create({
    threadId,
    messageId: sentWith ?? null,
    userId,
    fileName: 'statement.csv',
    mimeType: 'text/csv',
    kind: 'text' satisfies ChatAttachmentKind,
    sizeBytes: 12,
    sha256: randomUUID().replaceAll('-', ''),
    extractedText: 'a,b\n1,2',
  });
  // `createdAt` is read-only to a model update, so the age is backdated in SQL.
  await ChatAttachments.sequelize!.query('UPDATE "ChatAttachments" SET "createdAt" = :createdAt WHERE "id" = :id', {
    replacements: { createdAt: ago({ ms: ageMs }), id: attachment.id },
  });

  return attachment.id as string;
}

const statusOf = async ({ cardId }: { cardId: string }) => (await ChatProposals.findByPk(cardId))?.status;

describe('Chat retention cron', () => {
  it('deletes an expired unpinned thread with its messages, cards and attachments, and keeps the pinned and the unexpired ones', async () => {
    const expired = await seedThread({ expiry: 'past' });
    const appliedCard = await seedCard({
      ...expired,
      status: 'applied',
      expiresAt: ago({ ms: 40 * DAY_MS }),
    });
    const pendingCard = await seedCard({ ...expired, expiresAt: new Date(Date.now() + HOUR_MS) });
    const sentAttachment = await seedAttachment({ ...expired, sentWith: expired.messageId, ageMs: 50 * DAY_MS });
    const pinned = await seedThread({ expiry: 'none', pinned: true });
    const pinnedCard = await seedCard({ ...pinned, status: 'applied', expiresAt: ago({ ms: 40 * DAY_MS }) });
    const neverExpires = await seedThread({ expiry: 'none' });
    const live = await seedThread({ expiry: 'future' });
    const liveCard = await seedCard({ ...live, status: 'applied', expiresAt: ago({ ms: 2 * DAY_MS }) });

    const result = await chatRetentionCron.triggerManualSync();

    expect(result.deletedThreads).toBe(1);
    const gone = await helpers.getChatThread({ threadId: expired.threadId });
    expect(gone.statusCode).toBe(ERROR_CODES.NotFoundError);
    expect(await ChatMessages.count({ where: { threadId: expired.threadId } })).toBe(0);
    expect(await ChatProposals.count({ where: { id: [appliedCard, pendingCard] } })).toBe(0);
    expect(await ChatAttachments.count({ where: { id: sentAttachment } })).toBe(0);

    for (const kept of [pinned, neverExpires, live]) {
      const loaded = await helpers.getChatThread({ threadId: kept.threadId, raw: true });
      expect(loaded.messages).toHaveLength(1);
    }
    expect(await statusOf({ cardId: pinnedCard })).toBe('applied');
    expect(await statusOf({ cardId: liveCard })).toBe('applied');
  });

  it('keeps a thread that is past its expiry while a run is still streaming in it', async () => {
    const busy = await seedThread({ expiry: 'past' });
    await ChatMessages.create({
      threadId: busy.threadId,
      userId: busy.userId,
      role: 'assistant',
      status: 'streaming',
      runId: randomUUID(),
      parts: [],
    });

    const result = await chatRetentionCron.triggerManualSync();

    expect(result.deletedThreads).toBe(0);
    expect(await ChatThreads.count({ where: { id: busy.threadId } })).toBe(1);
  });

  it('expires pending cards older than their lifetime, pinned threads included, and leaves the rest', async () => {
    const pinned = await seedThread({ expiry: 'none', pinned: true });
    const unpinned = await seedThread({ expiry: 'future' });
    const duePinned = await seedCard({ ...pinned, expiresAt: ago({ ms: HOUR_MS }) });
    const dueUnpinned = await seedCard({ ...unpinned, expiresAt: ago({ ms: MINUTE_MS }) });
    const fresh = await seedCard({ ...unpinned, expiresAt: new Date(Date.now() + HOUR_MS) });
    const appliedLongAgo = await seedCard({ ...unpinned, status: 'applied', expiresAt: ago({ ms: 3 * DAY_MS }) });
    const rejectedLongAgo = await seedCard({ ...unpinned, status: 'rejected', expiresAt: ago({ ms: 3 * DAY_MS }) });

    const result = await chatRetentionCron.triggerManualSync();

    expect(result.expiredCards).toBe(2);
    for (const cardId of [duePinned, dueUnpinned]) {
      const card = (await ChatProposals.findByPk(cardId))!;
      expect(card.status).toBe('expired');
      expect(card.statusReason).toBe('expired');
      expect(card.decidedAt).not.toBeNull();
    }
    expect(await statusOf({ cardId: fresh })).toBe('pending');
    expect(await statusOf({ cardId: appliedLongAgo })).toBe('applied');
    expect(await statusOf({ cardId: rejectedLongAgo })).toBe('rejected');

    // The card endpoint agrees.
    const card = await helpers.getChatProposal({ proposalId: duePinned, raw: true });
    expect(card.status).toBe('expired');
  });

  it('deletes attachments that were never sent after an hour, and keeps sent and young ones', async () => {
    const seeded = await seedThread({ expiry: 'future' });
    const unsentOld = await seedAttachment({ ...seeded, ageMs: HOUR_MS + MINUTE_MS });
    const unsentYoung = await seedAttachment({ ...seeded, ageMs: 30 * MINUTE_MS });
    const sentOld = await seedAttachment({ ...seeded, sentWith: seeded.messageId, ageMs: 5 * DAY_MS });

    const result = await chatRetentionCron.triggerManualSync();

    expect(result.deletedAttachments).toBe(1);
    expect(await ChatAttachments.count({ where: { id: unsentOld } })).toBe(0);
    expect(await ChatAttachments.count({ where: { id: [unsentYoung, sentOld] } })).toBe(2);
  });

  it('turns a standalone card left applying for over 10 minutes into unknown, and leaves a recent one', async () => {
    const seeded = await seedThread({ expiry: 'future' });
    const expiresAt = new Date(Date.now() + HOUR_MS);
    const stuck = await seedCard({ ...seeded, status: 'applying', expiresAt, decidedAt: ago({ ms: 11 * MINUTE_MS }) });
    const running = await seedCard({ ...seeded, status: 'applying', expiresAt, decidedAt: ago({ ms: 2 * MINUTE_MS }) });

    const result = await chatRetentionCron.triggerManualSync();

    expect(result.unknownCards).toBe(1);
    const card = (await ChatProposals.findByPk(stuck))!;
    expect(card.status).toBe('unknown');
    expect(card.statusReason).toBe('applyUnknown');
    expect(await statusOf({ cardId: running })).toBe('applying');
  });

  it('works through more rows than one batch holds', async () => {
    const seeded = await seedThread({ expiry: 'future' });
    const dueIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      dueIds.push(await seedCard({ ...seeded, expiresAt: ago({ ms: HOUR_MS }) }));
      await seedAttachment({ ...seeded, ageMs: 2 * HOUR_MS });
    }
    for (let i = 0; i < 5; i++) await seedThread({ expiry: 'past' });

    const result = await chatRetentionCron.triggerManualSync({ batchSize: 2 });

    expect(result).toEqual({ expiredCards: 5, unknownCards: 0, deletedAttachments: 5, deletedThreads: 5 });
    expect(await ChatProposals.count({ where: { id: dueIds, status: 'expired' } })).toBe(5);
  });

  it('does nothing when there is nothing to sweep', async () => {
    expect(await chatRetentionCron.triggerManualSync()).toEqual({
      expiredCards: 0,
      unknownCards: 0,
      deletedAttachments: 0,
      deletedThreads: 0,
    });
  });
});
